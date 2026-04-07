'use client';

import React, { DependencyList, createContext, useContext, ReactNode, useMemo, useRef, useState, useEffect } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Auth, User, onAuthStateChanged, signOut } from 'firebase/auth';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { UserRole } from '@/lib/types';

export type StoredUserProfile = {
  id: string;
  role: UserRole;
  companyId: string;
  name: string;
  email: string | null;
  authProvider?: 'password' | 'anonymous';
  canLoginWithPassword?: boolean;
  inviteId?: string;
};

function isUserRole(value: unknown): value is UserRole {
  return value === 'ADMIN' || value === 'LEADER' || value === 'WORKER';
}

function clearStoredUserProfile(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('userRole');
  window.localStorage.removeItem('userName');
  window.localStorage.removeItem('companyId');
  window.localStorage.removeItem('userId');
}

function syncStoredUserProfile(profile: StoredUserProfile): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('userRole', profile.role);
  window.localStorage.setItem('userName', profile.name);
  window.localStorage.setItem('companyId', profile.companyId);
  window.localStorage.setItem('userId', profile.id);
}

function normalizeStoredUserProfile(user: User, data: Partial<StoredUserProfile>): StoredUserProfile {
  const role = data.role;
  const companyId = data.companyId?.trim();
  const name = data.name?.trim();

  if (!isUserRole(role) || !companyId || !name) {
    throw new Error('User profile is missing or incomplete. Contact an administrator.');
  }

  return {
    id: user.uid,
    role,
    companyId,
    name,
    email: typeof data.email === 'string' ? data.email : user.email ?? null,
    authProvider: data.authProvider,
    canLoginWithPassword: data.canLoginWithPassword,
    inviteId: data.inviteId,
  };
}

export async function loadUserProfileDocument(firestore: Firestore, user: User): Promise<StoredUserProfile> {
  const userRef = doc(firestore, 'users', user.uid);
  const userSnapshot = await getDoc(userRef);

  if (!userSnapshot.exists()) {
    throw new Error('User profile is missing or incomplete. Contact an administrator.');
  }

  const profile = normalizeStoredUserProfile(user, userSnapshot.data() as Partial<StoredUserProfile>);

  await setDoc(
    userRef,
    {
      lastLogin: serverTimestamp(),
    },
    { merge: true }
  );

  syncStoredUserProfile(profile);
  return profile;
}

interface FirebaseProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
}

interface UserAuthState {
  user: User | null;
  userProfile: StoredUserProfile | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export interface FirebaseContextState {
  areServicesAvailable: boolean;
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null;
  user: User | null;
  userProfile: StoredUserProfile | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export interface FirebaseServicesAndUser {
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  user: User | null;
  userProfile: StoredUserProfile | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export interface UserHookResult {
  user: User | null;
  userProfile: StoredUserProfile | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  firebaseApp,
  firestore,
  auth,
}) => {
  const [userAuthState, setUserAuthState] = useState<UserAuthState>({
    user: null,
    userProfile: null,
    isUserLoading: true,
    userError: null,
  });

  useEffect(() => {
    if (!auth) {
      setUserAuthState({
        user: null,
        userProfile: null,
        isUserLoading: false,
        userError: new Error('Auth service not provided.'),
      });
      return;
    }

    setUserAuthState({ user: null, userProfile: null, isUserLoading: true, userError: null });

    let isMounted = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (firebaseUser) => {
        if (!firebaseUser) {
          clearStoredUserProfile();
          if (isMounted) {
            setUserAuthState({ user: null, userProfile: null, isUserLoading: false, userError: null });
          }
          return;
        }

        if (isMounted) {
          setUserAuthState({ user: firebaseUser, userProfile: null, isUserLoading: true, userError: null });
        }

        try {
          const userProfile = await loadUserProfileDocument(firestore, firebaseUser);
          if (isMounted) {
            setUserAuthState({ user: firebaseUser, userProfile, isUserLoading: false, userError: null });
          }
        } catch (error) {
          const normalizedError = error instanceof Error ? error : new Error('Failed to load user profile.');
          const shouldTerminateSession = normalizedError.message.startsWith('User profile');

          if (shouldTerminateSession) {
            clearStoredUserProfile();
            try {
              await signOut(auth);
            } catch {
              // Preserve the original error even if session cleanup fails.
            }
          }

          if (isMounted) {
            setUserAuthState({
              user: shouldTerminateSession ? null : firebaseUser,
              userProfile: null,
              isUserLoading: false,
              userError: normalizedError,
            });
          }
        }
      },
      (error) => {
        console.error('FirebaseProvider: onAuthStateChanged error:', error);
        clearStoredUserProfile();
        setUserAuthState({ user: null, userProfile: null, isUserLoading: false, userError: error });
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [auth, firestore]);

  const contextValue = useMemo((): FirebaseContextState => {
    const servicesAvailable = !!(firebaseApp && firestore && auth);
    return {
      areServicesAvailable: servicesAvailable,
      firebaseApp: servicesAvailable ? firebaseApp : null,
      firestore: servicesAvailable ? firestore : null,
      auth: servicesAvailable ? auth : null,
      user: userAuthState.user,
      userProfile: userAuthState.userProfile,
      isUserLoading: userAuthState.isUserLoading,
      userError: userAuthState.userError,
    };
  }, [firebaseApp, firestore, auth, userAuthState]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = (): FirebaseServicesAndUser => {
  const context = useContext(FirebaseContext);

  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider.');
  }

  if (!context.areServicesAvailable || !context.firebaseApp || !context.firestore || !context.auth) {
    throw new Error('Firebase core services not available. Check FirebaseProvider props.');
  }

  return {
    firebaseApp: context.firebaseApp,
    firestore: context.firestore,
    auth: context.auth,
    user: context.user,
    userProfile: context.userProfile,
    isUserLoading: context.isUserLoading,
    userError: context.userError,
  };
};

export const useAuth = (): Auth => {
  const { auth } = useFirebase();
  return auth;
};

export const useFirestore = (): Firestore => {
  const { firestore } = useFirebase();
  return firestore;
};

export const useFirebaseApp = (): FirebaseApp => {
  const { firebaseApp } = useFirebase();
  return firebaseApp;
};

type MemoFirebase<T> = T & { __memo?: boolean };

export function useMemoFirebase<T>(factory: () => T, deps: DependencyList): T | MemoFirebase<T> {
  const valueRef = useRef<T | MemoFirebase<T> | undefined>(undefined);
  const depsRef = useRef<DependencyList | undefined>(undefined);

  const hasChanged =
    !depsRef.current ||
    deps.length !== depsRef.current.length ||
    deps.some((dependency, index) => dependency !== depsRef.current?.[index]);

  if (hasChanged) {
    const nextValue = factory();
    if (typeof nextValue === 'object' && nextValue !== null) {
      (nextValue as MemoFirebase<T>).__memo = true;
      valueRef.current = nextValue as MemoFirebase<T>;
    } else {
      valueRef.current = nextValue;
    }
    depsRef.current = deps;
  }

  return valueRef.current as T | MemoFirebase<T>;
}

export const useUser = (): UserHookResult => {
  const { user, userProfile, isUserLoading, userError } = useFirebase();
  return { user, userProfile, isUserLoading, userError };
};
