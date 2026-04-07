import { User, JobSite, Task } from './types';

export const MOCK_HQ = {
  address: 'Johannes-R.-Becher-Straße 25, 39218 Schönebeck (Elbe)',
  city: 'Schönebeck'
};

// Alle fiktiven Test-Mitarbeiter wurden entfernt.
// Das System startet nun leer und wartet auf die Registrierung des Admins.
export const MOCK_USERS: User[] = [];
export const MOCK_SITES: JobSite[] = [];
export const MOCK_TASKS: Task[] = [];
