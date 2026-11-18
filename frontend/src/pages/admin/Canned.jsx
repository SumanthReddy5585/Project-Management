import { useState } from 'react';
import { Plus, Pencil, Trash2, Zap } from 'lucide-react';
import { get, post, patch, del } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { Card, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useToast } from '../../components/ui.jsx';

/** Canned replies: saved answers agents insert into ticket replies. Placeholders are filled in automatically. */
export function AdminCanned() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get('/canned-responses'), []);
  const [edit, setEdit] = useState(null);
  const save = async () => {
    try { if (edit.id) await patch(`/canned-responses/${edit.id}`, { title: edit.title, body: edit.body }); else await post('/canned-responses', { title: edit.title, body: edit.body }); setEdit(null); reload(); toast('Saved', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <PageHeader title="Canned replies" sub="Saved answers agents can drop into a reply with one click." actions={<button className="btn btn-primary" onClick={() => setEdit({ title: '', body: '' })}><Plus size={15} /> New reply</button>} />
      <div className="notice info mb-3">Placeholders: <code>{'{{requester}}'}</code> client's first name, <code>{'{{number}}'}</code> ticket number, <code>{'{{agent}}'}</code> your name, <code>{'{{subject}}'}</code> ticket subject.</div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data.data.length === 0 ? <Card><Empty icon={Zap} title="No canned replies yet" /></Card> : (
        <Card bodyClass="p-0"><div className="table-wrap"><table className="table"><thead><tr><th>Title</th><th>Preview</th><th /></tr></thead><tbody>
          {data.data.map((c) => <tr key={c.id}><td className="fw-semibold text-nowrap">{c.title}</td><td className="small text-muted" style={{ maxWidth: 520 }}><div className="truncate">{c.body.replace(/\s+/g, ' ')}</div></td>
            <td className="text-end text-nowrap">{c.canEdit && <><button className="btn btn-sm btn-ghost btn-icon" aria-label={`Edit ${c.title}`} onClick={() => setEdit(c)}><Pencil size={14} /></button>
              <ConfirmButton className="btn btn-sm btn-ghost btn-icon" title={`Delete "${c.title}"?`} confirmLabel="Delete" onConfirm={async () => { await del(`/canned-responses/${c.id}`); reload(); }}><Trash2 size={14} aria-label="Delete" /></ConfirmButton></>}</td></tr>)}
        </tbody></table></div></Card>)}
      {edit && <Modal open size="lg" onClose={() => setEdit(null)} title={edit.id ? 'Edit canned reply' : 'New canned reply'} footer={<><button className="btn btn-light" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={edit.title.trim().length < 2 || !edit.body.trim()} onClick={save}>Save</button></>}>
        <Field label="Title">{(id) => <input id={id} className="form-control" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} autoFocus />}</Field>
        <Field label="Reply text">{(id) => <textarea id={id} className="form-control" rows={9} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />}</Field>
      </Modal>}
    </>
  );
}
