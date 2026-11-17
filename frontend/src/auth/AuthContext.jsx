import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, setCsrf } from '../api/client.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [me, setMe] = useState(undefined); // undefined = loading, null = anonymous
  const apply = (data) => { setCsrf(data?.csrfToken); setMe(data); return data; };
  const refresh = useCallback(() => get('/auth/me').then(apply).catch(() => apply(null)), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onExpired = () => apply(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);
  const value = useMemo(() => ({
    me, user: me?.user, role: me?.role, org: me?.organization, isCustomer: me?.role === 'CUSTOMER',
    can: (cap) => Boolean(me?.permissions?.org?.[cap]?.includes(me.role)),
    login: (email, password) => post('/auth/login', { email, password }).then(apply),
    acceptInvite: (body) => post('/auth/invitations/accept', body).then(apply),
    logout: () => post('/auth/logout').finally(() => apply(null)),
    refresh,
  }), [me, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
/** Project-level capability check against the server-provided matrix (UI only; the server enforces). */
export function projectCan(me, projectRole, cap) {
  return Boolean(projectRole && me?.permissions?.project?.[cap]?.includes(projectRole));
}
