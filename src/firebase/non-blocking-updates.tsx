'use client';
    
import {
  setDoc,
  updateDoc,
  deleteDoc,
  DocumentReference,
  SetOptions,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, isFirestorePermissionDeniedError } from '@/firebase/errors';

/**
 * Initiates a setDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: Record<string, unknown>, options: SetOptions) {
  setDoc(docRef, data, options).catch(error => {
    if (!isFirestorePermissionDeniedError(error)) {
      console.error('setDoc failed:', error);
      return;
    }

    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: 'write',
        requestResourceData: data,
      })
    );
  });
  // Execution continues immediately
}



/**
 * Initiates an updateDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: Record<string, unknown>) {
  updateDoc(docRef, data)
    .catch(error => {
      if (!isFirestorePermissionDeniedError(error)) {
        console.error('updateDoc failed:', error);
        return;
      }

      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: data,
        })
      )
    });
}


/**
 * Initiates a deleteDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  deleteDoc(docRef)
    .catch(error => {
      if (!isFirestorePermissionDeniedError(error)) {
        console.error('deleteDoc failed:', error);
        return;
      }

      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        })
      )
    });
}
