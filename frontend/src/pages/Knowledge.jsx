import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BookOpen, Search, Plus, ArrowLeft, Pencil, Trash2, ThumbsUp, ThumbsDown, Lock, Eye, FileText, LifeBuoy } from 'lucide-react';
import { get, post, patch, del } from '../api/client.js';
import { useLoad, useDebounced } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { fmtDate, fmtRelative } from '../lib/format.js';
import { Card, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, useToast, fieldErrors } from '../components/ui.jsx';

function ArticleEditor({ article, categories, onClose, onSaved }) {
  const [f, setF] = useState({ title: article?.title || '', body: article?.body || '', category: article?.category || categories[0] || 'General', visibility: article?.visibility || 'PUBLIC', published: article?.published ?? true });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrors(err);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = article ? await patch(`/kb/articles/${article.id}`, f) : await post('/kb/articles', f); onSaved(r); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Modal open size="lg" onClose={onClose} title={article ? 'Edit article' : 'New help article'} footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="kbf" disabled={busy || f.title.trim().length < 3 || !f.body.trim()}>{busy ? 'Saving…' : f.published ? 'Publish' : 'Save draft'}</button></>}>
      <ErrorBox error={err} />
      <form id="kbf" onSubmit={save}>
        <Field label="Title" error={fe.title}>{(id) => <input id={id} className="form-control" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="How to reset your password" autoFocus />}</Field>
        <div className="row">
          <div className="col-md-6"><Field label="Category" hint="Pick one or type a new one">{(id) => <><input id={id} list="kb-cats" className="form-control" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="kb-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></>}</Field></div>
          <div className="col-md-6"><Field label="Who can read it">{(id) => <select id={id} className="form-select" value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })}><option value="PUBLIC">Everyone, including clients</option><option value="INTERNAL">Team only (internal playbook)</option></select>}</Field></div>
        </div>
        <Field label="Article" hint="Plain text. Use blank lines between paragraphs and • or 1. for lists.">{(id) => <textarea id={id} className="form-control" rows={14} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ fontFamily: 'inherit', lineHeight: 1.6 }} />}</Field>
        <div className="form-check form-switch"><input className="form-check-input" type="checkbox" role="switch" id="kbp" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /><label className="form-check-label" htmlFor="kbp">Published {f.published ? '' : <span className="text-muted">(draft — only your team can see it)</span>}</label></div>
      </form>
    </Modal>
  );
}

export function KnowledgeBase() {
  const { isCustomer } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [cat, setCat] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useLoad(() => get('/kb/articles', { q: dq || undefined, category: cat || undefined }), [dq, cat]);
  useLive((e) => e.type === 'kb.changed', () => reload({ silent: true }));
  const creating = params.get('new') === '1';
  const close = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n; });
  const cats = data?.categories || [];
  return (
    <>
      <div className="kb-hero">
        <h1>{isCustomer ? 'Help center' : 'Knowledge base'}</h1>
        <p>{isCustomer ? 'Answers to common questions. Can’t find it? Raise a ticket and we’ll help.' : 'Articles your clients can self-serve, plus internal playbooks for the team.'}</p>
        <div className="position-relative" style={{ maxWidth: 560, zIndex: 1 }}><Search size={17} className="position-absolute text-muted" style={{ left: 13, top: 14 }} /><input className="form-control" placeholder="Search articles…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search articles" autoFocus={Boolean(params.get('q'))} /></div>
      </div>
      <div className="row g-3">
        <div className="col-lg-3">
          <nav className="views" aria-label="Categories">
            <div className="vh">Categories</div>
            <button className={!cat ? 'active' : ''} onClick={() => setCat('')}><BookOpen size={15} />All articles<span className="n">{cats.reduce((s, c) => s + c.count, 0) || ''}</span></button>
            {cats.map((c) => <button key={c.name} className={cat === c.name ? 'active' : ''} onClick={() => setCat(c.name)}><FileText size={15} />{c.name}<span className="n">{c.count}</span></button>)}
          </nav>
          <div className="d-grid gap-2 mt-3">
            {!isCustomer && <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus size={15} /> New article</button>}
            {isCustomer && <Link to="/tickets?new=1" className="btn btn-light"><LifeBuoy size={15} /> Still need help? Raise a ticket</Link>}
          </div>
        </div>
        <div className="col-lg-9">
          <ErrorBox error={error} onRetry={reload} />
          {loading && !data ? <Loading rows={6} /> : data.data.length === 0 ? <Card><Empty icon={BookOpen} title={dq ? `No articles match “${dq}”` : 'No articles yet'} action={isCustomer ? <Link to="/tickets?new=1" className="btn btn-sm btn-primary">Raise a ticket</Link> : <button className="btn btn-sm btn-primary" onClick={() => setParams({ new: '1' })}>Write the first article</button>} /></Card> : (
            <div className="row g-3">{data.data.map((a) => (
              <div key={a.id} className="col-md-6">
                <Link to={`/kb/${a.id}`} className="tile h-100">
                  <div className="d-flex align-items-center gap-2 mb-2 small text-muted"><span className="pill pill-blue">{a.category}</span>{!a.published && <span className="pill pill-warn">Draft</span>}{a.visibility === 'INTERNAL' && <span className="pill pill-neutral"><Lock size={10} /> Team only</span>}<span className="ms-auto">{fmtRelative(a.updatedAt)}</span></div>
                  <div className="fw-semibold mb-1" style={{ fontSize: '0.98rem' }}>{a.title}</div>
                  <div className="small text-muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.excerpt}</div>
                  {!isCustomer && <div className="d-flex gap-3 small text-muted mt-2"><span><Eye size={12} /> {a.views}</span><span><ThumbsUp size={12} /> {a.helpfulYes}</span><span><ThumbsDown size={12} /> {a.helpfulNo}</span></div>}
                </Link>
              </div>))}</div>)}
        </div>
      </div>
      {creating && <ArticleEditor categories={cats.map((c) => c.name)} onClose={close} onSaved={(a) => { toast('Article saved', 'success'); nav(`/kb/${a.id}`); }} />}
    </>
  );
}

export function KnowledgeArticle() {
  const { articleId } = useParams();
  const { isCustomer, role } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data: a, error, loading, reload } = useLoad(() => get(`/kb/articles/${articleId}`), [articleId]);
  const cats = useLoad(() => get('/kb/articles'), []);
  const [editing, setEditing] = useState(false);
  const [voted, setVoted] = useState(false);
  if (loading && !a) return <Loading rows={8} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const vote = async (helpful) => { try { await post(`/kb/articles/${a.id}/feedback`, { helpful }); setVoted(true); } catch (e) { toast(e.message, 'error'); } };
  const related = (cats.data?.data || []).filter((x) => x.category === a.category && x.id !== a.id).slice(0, 5);
  return (
    <>
      <div className="mb-2"><Link to="/kb" className="small d-inline-flex align-items-center gap-1 text-muted"><ArrowLeft size={14} /> {isCustomer ? 'Help center' : 'Knowledge base'}</Link></div>
      <div className="row g-3">
        <div className="col-lg-8">
          <Card>
            <div className="d-flex align-items-center gap-2 small text-muted mb-2 flex-wrap"><span className="pill pill-blue">{a.category}</span>{!a.published && <span className="pill pill-warn">Draft</span>}{a.visibility === 'INTERNAL' && <span className="pill pill-neutral"><Lock size={10} /> Team only</span>}<span>Updated {fmtDate(a.updatedAt)}</span>{a.authorName && <span>· by {a.authorName}</span>}
              {a.canEdit && <span className="ms-auto d-flex gap-1"><button className="btn btn-sm btn-light" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>
                {['ADMIN', 'MANAGER'].includes(role) && <ConfirmButton className="btn btn-sm btn-ghost btn-icon" title="Delete this article?" message="Clients will no longer see it. This cannot be undone." confirmLabel="Delete" onConfirm={async () => { await del(`/kb/articles/${a.id}`); toast('Article deleted', 'success'); nav('/kb'); }}><Trash2 size={14} aria-label="Delete" /></ConfirmButton>}</span>}
            </div>
            <h1 className="h3 fw-bold mb-3">{a.title}</h1>
            <div className="article-body">{a.body}</div>
            {a.published && <div className="border-top mt-4 pt-3 d-flex align-items-center gap-2 flex-wrap">
              {voted ? <span className="small text-muted">Thanks for the feedback.</span> : <><span className="small fw-semibold">Was this helpful?</span><button className="btn btn-sm btn-light" onClick={() => vote(true)}><ThumbsUp size={14} /> Yes</button><button className="btn btn-sm btn-light" onClick={() => vote(false)}><ThumbsDown size={14} /> No</button></>}
              <Link to="/tickets?new=1" className="btn btn-sm btn-link ms-auto">Still stuck? Raise a ticket</Link>
            </div>}
          </Card>
        </div>
        <div className="col-lg-4">
          <Card title={`More in ${a.category}`}>{related.length ? <ul className="list-plain">{related.map((r) => <li key={r.id}><FileText size={15} className="text-muted flex-shrink-0" /><Link to={`/kb/${r.id}`} className="text-body small">{r.title}</Link></li>)}</ul> : <div className="small text-muted">No other articles in this category.</div>}</Card>
          {!isCustomer && <Card title="Article stats" className="mt-3"><div className="d-flex justify-content-around text-center"><div><div className="fw-bold fs-5 num">{a.views}</div><div className="small text-muted">views</div></div><div><div className="fw-bold fs-5 num text-success">{a.helpfulYes}</div><div className="small text-muted">helpful</div></div><div><div className="fw-bold fs-5 num text-danger">{a.helpfulNo}</div><div className="small text-muted">not helpful</div></div></div></Card>}
        </div>
      </div>
      {editing && <ArticleEditor article={a} categories={(cats.data?.categories || []).map((c) => c.name)} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); toast('Article updated', 'success'); }} />}
    </>
  );
}
