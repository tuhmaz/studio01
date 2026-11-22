'use client';
import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/auth/SetPasswordForm';

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><SetPasswordForm purpose="reset" /></Suspense>;
}
