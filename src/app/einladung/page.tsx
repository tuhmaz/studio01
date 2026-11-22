'use client';
import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/auth/SetPasswordForm';

export default function InvitePage() {
  return <Suspense fallback={null}><SetPasswordForm purpose="invite" /></Suspense>;
}
