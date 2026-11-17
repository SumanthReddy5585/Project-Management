import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Lock, Globe, Paperclip, Trash2, Upload, AtSign } from 'lucide-react';
import { get, post, upload, download, del } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { fmtDateTime, fmtRelative, renderMentions } from '../lib/format.js';
import { Avatar, ErrorBox, Loading, useToast, ConfirmButton } from './ui.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

// ---------- Mention-aware composer ----------
export function MentionTextarea({ value, onChange, people = [], placeholder, id, rows = 3 }) {
  const [query, setQuery] = useState(null);
  const ref = useRef(null);
  const onInput = (e) => {
    onChange(e.target.value);
    const before = e.target.value.slice(0, e.target.selectionStart);
    const m = before.match(/@([\w .-]{0,30})$/);
    setQuery(m ? m[1].toLowerCase() : null);
  };
  const pick = (p) => {
    const el = ref.current;
    const pos = el.selectionStart;
    const before = value.slice(0, pos).replace(/@([\w .-]{0,30})$/, `@[${p.name}](${p.id}) `);
    onChange(before + value.slice(pos));
    setQuery(null);
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = before.length; });
  };
  const matches = query == null ? [] : people.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 6);
  return (
    <div className="position-relative">
      <textarea ref={ref} id={id} className="form-control" rows={rows} value={value} onChange={onInput} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Escape') setQuery(null); }} aria-describedby={`${id}-help`} />
      {people.length > 0 && <div id={`${id}-help`} className="form-text d-flex align-items-center gap-1"><AtSign size={11} /> Type @ to mention someone who can see this conversation.</div>}
      {matches.length > 0 && (
        <div className="search-results" style={{ top: 'auto', bottom: '100%' }} role="listbox" aria-label="Mention suggestions">
          {matches.map((p) => <a href="#" key={p.id} role="option" onMouseDown={(e) => { e.preventDefault(); pick(p); }}><Avatar name={p.name} />{p.name}</a>)}
        </div>
      )}
    </div>
  );
}

export function Message({ m, internalLabel = 'Team only' }) {
  return (
    <div className={`msg ${m.visibility === 'INTERNAL' ? 'internal' : ''}`}>
      <div className="meta"><Avatar name={m.author?.name} /><strong className="text-body">{m.author?.name ?? 'Unknown'}</strong>
        <span title={fmtDateTime(m.createdAt)}>{fmtRelative(m.createdAt)}</span>
        {m.visibility === 'INTERNAL' && <span className="pill pill-warn"><Lock size={10} /> {internalLabel}</span>}
        {m.visibility === 'PUBLIC' && m.showPublic && <span className="pill pill-blue"><Globe size={10} /> Shared with client</span>}
        {m.editedAt && <span>(edited)</span>}</div>
      <div className="body">{m.deleted ? <em className="text-muted">Comment deleted</em> : renderMentions(m.body)}</div>
    </div>
  );
}

/** Visibility choice for internal users. Customers never see this control. */
export function VisibilityToggle({ value, onChange, canInternal, canPublic, publicHint }) {
  return (
    <div className="btn-group btn-group-sm vis-toggle" role="group" aria-label="Who can see this">
      <button type="button" className={`btn btn-light internal ${value === 'INTERNAL' ? 'active' : ''}`} disabled={!canInternal} onClick={() => onChange('INTERNAL')} aria-pressed={value === 'INTERNAL'}><Lock size={12} /> Team only</button>
      <button type="button" className={`btn btn-light ${value === 'PUBLIC' ? 'active' : ''}`} disabled={!canPublic} title={!canPublic ? publicHint : undefined} onClick={() => onChange('PUBLIC')} aria-pressed={value === 'PUBLIC'}><Globe size={12} /> Share with client</button>
    </div>
  );
}

/** Generic comment thread for work items and discussions. */
export function CommentThread({ targetType, targetId, people = [] }) {
  const { isCustomer } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get('/comments', { targetType, targetId }), [targetType, targetId]);
  const [body, setBody] = useState('');
  const [vis, setVis] = useState('INTERNAL');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !data.canInternal && data.canPublic) setVis('PUBLIC'); }, [data]);
  const send = async (e) => {
    e.preventDefault(); if (!body.trim()) return;
    setBusy(true);
    try { await post('/comments', { targetType, targetId, body, visibility: isCustomer ? 'PUBLIC' : vis }); setBody(''); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  if (loading && !data) return <Loading rows={2} />;
  const id = `c-${targetId}`;
  return (
    <div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="thread mb-3">
        {data?.data.length === 0 && <div className="text-muted small">No comments yet.</div>}
        {data?.data.map((m) => <Message key={m.id} m={{ ...m, showPublic: !isCustomer }} />)}
      </div>
      {(data?.canInternal || data?.canPublic) && (
        <form onSubmit={send} className="composer">
          <label htmlFor={id} className="visually-hidden">Add a comment</label>
          <MentionTextarea id={id} value={body} onChange={setBody} people={people} placeholder={isCustomer ? 'Write a comment…' : vis === 'INTERNAL' ? 'Team-only note — the client won\'t see this' : 'The client will see this'} />
          <div className="d-flex justify-content-between align-items-center mt-2 gap-2 flex-wrap">
            {!isCustomer ? <VisibilityToggle value={vis} onChange={setVis} canInternal={data.canInternal} canPublic={data.canPublic} publicHint="Share this task with the client first" /> : <span />}
            <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>{busy ? 'Posting…' : 'Post comment'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------- Files ----------
const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export function FileList({ targetType, targetId, compact, onChange }) {
  const { isCustomer, user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get('/files', { targetType, targetId }), [targetType, targetId]);
  const [vis, setVis] = useState('INTERNAL');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => { if (data && !data.canUploadInternal && data.canUploadPublic) setVis('PUBLIC'); }, [data]);
  const onFiles = async (files) => {
    if (!files?.length) return;
    const form = new FormData();
    form.append('targetType', targetType); form.append('targetId', targetId); form.append('visibility', vis);
    for (const f of files) form.append('files', f);
    setBusy(true);
    try { await upload(form); toast(`${files.length} file(s) uploaded`, 'success'); reload(); onChange?.(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  if (loading && !data) return <Loading rows={1} />;
  const canUpload = data?.canUploadInternal || data?.canUploadPublic;
  return (
    <div>
      <ErrorBox error={error} />
      {data?.data.length === 0 && <div className="text-muted small mb-2">No files.</div>}
      <ul className="list-plain">
        {data?.data.map((f) => (
          <li key={f.id}>
            <FileText size={16} className="text-muted flex-shrink-0" aria-hidden="true" />
            <div className="flex-grow-1 min-w-0"><div className="truncate fw-medium">{f.name}</div><div className="small text-muted">{fmtSize(f.size)} · {fmtRelative(f.createdAt)}</div></div>
            {!isCustomer && f.visibility === 'INTERNAL' && <span className="pill pill-warn"><Lock size={10} /> Team only</span>}
            {!isCustomer && f.visibility === 'PUBLIC' && <span className="pill pill-blue"><Globe size={10} /> Shared</span>}
            <button className="btn btn-sm btn-ghost btn-icon" onClick={() => download(`/files/${f.id}/download`, f.name).catch((e) => toast(e.message, 'error'))} aria-label={`Download ${f.name}`}><Download size={15} /></button>
            {f.uploadedById === user.id && <ConfirmButton className="btn btn-sm btn-ghost btn-icon text-danger" title="Delete file?" message={`"${f.name}" will be removed.`} confirmLabel="Delete" onConfirm={async () => { await del(`/files/${f.id}`); reload(); }}><Trash2 size={15} aria-label={`Delete ${f.name}`} /></ConfirmButton>}
          </li>
        ))}
      </ul>
      {canUpload && (
        <div className="d-flex align-items-center gap-2 mt-2 flex-wrap">
          {!isCustomer && targetType !== 'deliverableVersion' && <VisibilityToggle value={vis} onChange={setVis} canInternal={data.canUploadInternal} canPublic={data.canUploadPublic} publicHint="Share this with the client first" />}
          <input ref={input} type="file" multiple className="d-none" id={`f-${targetId}`} onChange={(e) => onFiles(e.target.files)} accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md,.json,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx" />
          <label htmlFor={`f-${targetId}`} className={`btn btn-sm btn-outline-primary mb-0 ${busy ? 'disabled' : ''}`}>{busy ? 'Uploading…' : <><Upload size={14} /> {compact ? 'Attach' : 'Upload files'}</>}</label>
          {!compact && <span className="form-text m-0"><Paperclip size={11} /> PDF, images, Office, text, CSV, ZIP · max 20 MB</span>}
        </div>
      )}
    </div>
  );
}
