import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialRequestOptionsJSON,
  PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import type { User } from '../database/data-structures';
import {
  apiFetch,
  buildJsonRequestInit,
  fetchJson,
  ensurePayload,
  readErrorMessage,
  readJsonBody,
} from '../api-client';
import { mapUserFromServer } from './users';

export interface PasskeyAuthResponse {
  user: User;
  token: string;
  refreshToken?: string;
}

interface AuthBeginResponse {
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeId: string;
}

interface RegisterBeginResponse {
  options: PublicKeyCredentialCreationOptionsJSON;
  challengeId: string;
}

const mapAuthResponse = (payload: Record<string, unknown>): PasskeyAuthResponse => {
  if (typeof payload.token !== 'string' || !payload.token) {
    throw new Error('Authentication response missing token');
  }
  if (!payload.user || typeof payload.user !== 'object') {
    throw new Error('Authentication response missing user payload');
  }
  const user = mapUserFromServer(payload.user as Record<string, unknown>);
  const refreshToken = typeof payload.refreshToken === 'string' ? payload.refreshToken : undefined;
  return { user, token: payload.token, refreshToken };
};

export async function loginWithPasskey(): Promise<PasskeyAuthResponse> {
  const begin = await fetchJson<AuthBeginResponse>(
    '/api/auth/passkey/authenticate/begin',
    buildJsonRequestInit('POST', {}),
    'Failed to start passkey sign-in',
  );

  const beginPayload = ensurePayload(begin, 'Authentication begin response missing payload');

  const response = await startAuthentication({ optionsJSON: beginPayload.options });

  const finish = await fetchJson<Record<string, unknown>>(
    '/api/auth/passkey/authenticate/finish',
    buildJsonRequestInit('POST', {
      challengeId: beginPayload.challengeId,
      response,
    }),
    'Passkey sign-in failed',
  );

  return mapAuthResponse(ensurePayload(finish, 'Authentication finish response missing payload'));
}

export interface EnrolmentPreview {
  user: { id: string; username: string; email: string };
}

export async function getEnrolment(token: string): Promise<EnrolmentPreview> {
  const data = await fetchJson<EnrolmentPreview>(
    `/api/auth/enrolment/${encodeURIComponent(token)}`,
    { method: 'GET' },
    'Failed to load enrolment',
  );
  return ensurePayload(data, 'Enrolment lookup response missing payload');
}

export async function enrolWithPasskey(
  token: string,
  deviceName?: string,
): Promise<PasskeyAuthResponse> {
  const begin = await fetchJson<RegisterBeginResponse>(
    `/api/auth/enrolment/${encodeURIComponent(token)}/register/begin`,
    buildJsonRequestInit('POST', {}),
    'Failed to start passkey registration',
  );
  const beginPayload = ensurePayload(begin, 'Enrolment begin response missing payload');

  const response = await startRegistration({ optionsJSON: beginPayload.options });

  const finish = await fetchJson<Record<string, unknown>>(
    `/api/auth/enrolment/${encodeURIComponent(token)}/register/finish`,
    buildJsonRequestInit('POST', {
      challengeId: beginPayload.challengeId,
      response,
      deviceName,
    }),
    'Passkey registration failed',
  );

  return mapAuthResponse(ensurePayload(finish, 'Enrolment finish response missing payload'));
}

export async function addPasskey(deviceName?: string): Promise<void> {
  const beginResp = await apiFetch('/api/auth/passkey/register/begin', buildJsonRequestInit('POST', {}));
  if (!beginResp.ok) {
    throw new Error(await readErrorMessage(beginResp, 'Failed to start passkey registration'));
  }
  const begin = await readJsonBody<RegisterBeginResponse>(beginResp);

  const response = await startRegistration({ optionsJSON: begin.options });

  const finishResp = await apiFetch(
    '/api/auth/passkey/register/finish',
    buildJsonRequestInit('POST', {
      challengeId: begin.challengeId,
      response,
      deviceName,
    }),
  );
  if (!finishResp.ok) {
    throw new Error(await readErrorMessage(finishResp, 'Failed to register passkey'));
  }
}

export interface PasskeyRecord {
  id: string;
  credential_id: string;
  device_name: string | null;
  transports: string[] | null;
  created_at: string;
  last_used_at: string | null;
}

export async function listPasskeys(): Promise<PasskeyRecord[]> {
  const data = await fetchJson<{ passkeys: PasskeyRecord[] }>(
    '/api/users/me/passkeys',
    { method: 'GET' },
    'Failed to load passkeys',
  );
  return data?.passkeys ?? [];
}

export async function removePasskey(id: string): Promise<void> {
  const response = await apiFetch(`/api/users/me/passkeys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to remove passkey'));
  }
}
