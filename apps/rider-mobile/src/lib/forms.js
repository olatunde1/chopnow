import { ApiError } from './api-client';

/** Converts a zod safeParse failure into { field: firstMessage }. */
export function zodFieldErrors(result) {
  if (result.success) return {};
  const out = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Splits an API error into field errors and a general message for the form. */
export function apiFormErrors(err) {
  if (err instanceof ApiError) {
    const fields = err.fieldErrors();
    return { fields, message: Object.keys(fields).length ? null : err.message };
  }
  return { fields: {}, message: 'Something went wrong. Please try again.' };
}

/** Builds the registration payload; vehicle fields are nested under `rider` as the API expects. */
export function toRegistration(form) {
  return {
    fullName: form.fullName,
    email: form.email,
    phone: form.phone || undefined,
    password: form.password,
    role: 'RIDER',
    rider: { vehicleType: form.vehicleType, ...(form.vehiclePlate.trim() ? { vehiclePlate: form.vehiclePlate.trim().toUpperCase() } : {}) },
  };
}
