import { useEffect, useState } from 'react';
import { fetchPlan, savePlan, type Plan } from '../api';

/**
 * Test-plan tab — view the QA Lead's plan (qa/test-plan-sprint*.txt) and edit it
 * in place. Edits matter most at the proceed checkpoint: the workers fs_read the
 * plan file AFTER approval, so what is saved here is what the society builds on.
 */
export function PlanView({ awaitingProceed }: { awaitingProceed: boolean }) {
  const [plan, setPlan] = useState<Plan>({ file: null, content: null });
  const [draft, setDraft] = useState<string | null>(null); // null = view mode
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const p = await fetchPlan();
    setPlan(p);
  };
  // refetch whenever the tab mounts or the checkpoint state flips (plan is
  // written just before the checkpoint arms, so this catches it appearing)
  useEffect(() => { load(); }, [awaitingProceed]);

  const startEdit = () => { setDraft(plan.content ?? ''); setNotice(null); };
  const cancel = () => setDraft(null);
  const save = async () => {
    if (draft == null) return;
    setSaving(true);
    const ok = await savePlan(draft);
    setSaving(false);
    if (ok) {
      setDraft(null);
      setNotice('saved — the workers will read this version after you approve');
      load();
    } else {
      setNotice('save failed — is the server reachable?');
    }
  };

  if (!plan.file) {
    return (
      <div className="panel-body">
        <div className="empty">no test plan yet — qa-lead writes qa/test-plan-sprint1.txt in Phase 1</div>
      </div>
    );
  }

  return (
    <div className="panel-body">
      <div className="plan-toolbar">
        <code>qa/{plan.file}</code>
        {awaitingProceed && draft == null && (
          <span className="plan-hint">run paused at checkpoint — edit now, then approve</span>
        )}
        {notice && <span className="plan-hint">{notice}</span>}
        <span className="spacer" />
        {draft == null ? (
          <button className="btn" onClick={startEdit}>✎ Edit</button>
        ) : (
          <>
            <button className="btn" disabled={saving} onClick={save}>{saving ? 'saving…' : '✔ Save'}</button>
            <button className="btn ghost" disabled={saving} onClick={cancel}>Cancel</button>
          </>
        )}
      </div>
      {draft == null
        ? <pre className="signoff-pre">{plan.content}</pre>
        : <textarea className="plan-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />}
    </div>
  );
}
