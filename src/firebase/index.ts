'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, deleteUser, signOut } from 'firebase/auth';
import { deleteDoc, doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import { UserRole } from '@/lib/types';

export function initializeFirebase() {
  if (!getApps().length) {
    let firebaseApp;
    try {
      firebaseApp = initializeApp();
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        console.warn('Automatic initialization failed. Falling back to firebase config object.', error);
      }
      firebaseApp = initializeApp(firebaseConfig);
    }

    return getSdks(firebaseApp);
  }

  return getSdks(getApp());
}

export function getSdks(firebaseApp: FirebaseApp) {
  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore: getFirestore(firebaseApp),
  };
}

type ProvisionPasswordAccountInput = {
  companyId: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  inviteId: string;
};

type ProvisionPasswordAccountResult = {
  uid: string;
};

export async function provisionPasswordAccount({
  companyId,
  email,
  password,
  name,
  role,
  inviteId,
}: ProvisionPasswordAccountInput): Promise<ProvisionPasswordAccountResult> {
  const appName = `managed-user-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);
  const secondaryFirestore = getFirestore(secondaryApp);
  const inviteRef = doc(secondaryFirestore, 'accountInvites', inviteId);
  let createdUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user'] | null = null;

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    createdUser = credential.user;

    await setDoc(
      doc(secondaryFirestore, 'users', createdUser.uid),
      {
        id: createdUser.uid,
        companyId,
        role,
        name,
        email,
        authProvider: 'password',
        canLoginWithPassword: true,
        inviteId,
        lastLogin: serverTimestamp(),
      },
      { merge: true }
    );

    await deleteDoc(inviteRef);
    return { uid: createdUser.uid };
  } catch (error) {
    if (createdUser) {
      try {
        await deleteUser(createdUser);
      } catch {
        // Auth cleanup can fail if the account was already removed by rules or a previous retry.
      }
    }
    throw error;
  } finally {
    try {
      await signOut(secondaryAuth);
    } catch {
      // Continue cleanup even if sign-out fails.
    }
    await deleteApp(secondaryApp);
  }
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './errors';
export * from './error-emitter';
