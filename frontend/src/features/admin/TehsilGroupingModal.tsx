// Port of components/Admin/TehsilGroupingModal.js (nav "🔗 Link & Group Tehsils").
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Pencil, Plus, Unlink } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Badge, Modal, Spinner, cn, useDialog } from '@/shared/ui';
import { fetchTehsils } from '@/shared/lib/mouzaApi';

export default function TehsilGroupingModal({ show, onHide, onUpdated }: { show: boolean; onHide: () => void; onUpdated?: () => void }) {
  const dialog = useDialog();
  const [groups, setGroups] = useState<any[]>([]);
  const [allTehsils, setAllTehsils] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [selectedTehsils, setSelectedTehsils] = useState<string[]>([]);
  const [tehsilSearch, setTehsilSearch] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [groupsRes, tehsilsList] = await Promise.all([api.get('/api/admin/tehsil-groups'), fetchTehsils()]);
      setGroups(Array.isArray(groupsRes.data) ? groupsRes.data : []);
      setAllTehsils(Array.isArray(tehsilsList) ? tehsilsList : []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load tehsil groups');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditingGroupId(null);
    setGroupName('');
    setSelectedTehsils([]);
    setTehsilSearch('');
    setIsCreatingNew(false);
  };

  useEffect(() => {
    if (show) {
      loadData();
      resetForm();
    }
  }, [show]);

  const handleStartEdit = (group: any) => {
    setEditingGroupId(group._id);
    setGroupName(group.canonicalName || '');
    setSelectedTehsils([...(group.aliases || [])]);
    setIsCreatingNew(true);
    setTehsilSearch('');
  };

  const toggle = (t: string) => setSelectedTehsils((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const handleSaveGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return setError('Please provide a group name.');
    if (selectedTehsils.length < 2) return setError('Please select at least 2 tehsils to link together.');
    try {
      setSaving(true);
      setError(null);
      if (editingGroupId) {
        await api.put(`/api/admin/tehsil-groups/${editingGroupId}`, { canonicalName: groupName, aliases: selectedTehsils });
        setSuccess(`Group "${groupName}" updated successfully!`);
      } else {
        await api.post('/api/admin/tehsil-groups', { canonicalName: groupName, aliases: selectedTehsils });
        setSuccess(`Linked tehsils as "${groupName}" successfully!`);
      }
      await loadData();
      resetForm();
      onUpdated?.();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save tehsil group.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async (group: any) => {
    const ok = await dialog.confirm(
      `Are you sure you want to unlink "${group.canonicalName}"? Tehsils (${(group.aliases || []).join(', ')}) will revert to isolated mouza lists.`,
      { variant: 'danger', okLabel: 'Unlink' },
    );
    if (!ok) return;
    try {
      setSaving(true);
      setError(null);
      const { data } = await api.delete(`/api/admin/tehsil-groups/${group._id}`);
      setSuccess(
        data?.usersUpdated !== undefined
          ? `Group "${group.canonicalName}" unlinked. ${data.usersUpdated} user(s) moved back to ${(group.aliases || []).join(', ')}.`
          : `Group "${group.canonicalName}" unlinked successfully.`,
      );
      await loadData();
      if (editingGroupId === group._id) resetForm();
      onUpdated?.();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to unlink group.');
    } finally {
      setSaving(false);
    }
  };

  const alreadyLinkedMap = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((g) => {
      if (g._id !== editingGroupId && Array.isArray(g.aliases)) g.aliases.forEach((a: string) => map.set(a.toLowerCase(), g.canonicalName));
    });
    return map;
  }, [groups, editingGroupId]);

  const filteredTehsils = useMemo(() => {
    const q = tehsilSearch.trim().toLowerCase();
    return q ? allTehsils.filter((t) => t.toLowerCase().includes(q)) : allTehsils;
  }, [allTehsils, tehsilSearch]);

  return (
    <Modal
      show={show}
      onHide={onHide}
      size="lg"
      headerVariant="custom"
      headerClassName="bg-[#f8fafc] border-b border-[#e2e8f0] text-[#1f2937] !px-[18px] !py-3"
      title={<span className="flex items-center gap-2 text-[#1f2937]"><span className="text-xl">🔗</span><span>Tehsil Linking &amp; Alias Groups</span></span>}
      bodyClassName="!p-[18px] max-sm:!p-3"
      footerClassName="!bg-[#f8fafc] border-t-[#e2e8f0] !px-[18px] !py-2.5"
      footer={<button className="btn btn-sm btn-secondary" onClick={onHide}>Close</button>}
    >
      {error && <Alert variant="danger" onClose={() => setError(null)} className="mb-3 py-2 text-sm">{error}</Alert>}
      {success && <Alert variant="success" onClose={() => setSuccess(null)} className="mb-3 py-2 text-sm">{success}</Alert>}

      <div className="mb-3 rounded-lg border-l-4 border-[#3b82f6] bg-[#f1f5f9] px-3.5 py-2.5 text-[0.82rem] leading-[1.45] text-[#475569]">
        Link spelling variations (e.g. <code>pakpatan</code> &amp; <code>pakpattan</code>) to share combined, deduplicated mouzas without altering any user profile or filesystem folders.
      </div>

      {loading ? (
        <div className="py-6 text-center">
          <Spinner size="sm" />
          <div className="mt-2 text-sm text-ink-2">Loading tehsil groups...</div>
        </div>
      ) : isCreatingNew ? (
        <div className="mb-3 rounded-lg border border-[#cbd5e1] bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h6 className="m-0 font-bold text-[#0d6efd]">{editingGroupId ? `✏️ Edit Group: ${groupName}` : '➕ Link New Tehsils'}</h6>
            <button className="btn btn-sm btn-outline-secondary" onClick={resetForm}>Cancel</button>
          </div>
          <form onSubmit={handleSaveGroup}>
            <div className="mb-3">
              <label className="mb-1 block text-sm font-bold">Group Canonical Name</label>
              <input className="input input-sm" placeholder="e.g. Pakpattan, Ahmadpur East..." value={groupName} onChange={(e) => setGroupName(e.target.value)} required />
            </div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-bold">Selected Tehsils ({selectedTehsils.length})</span>
              {selectedTehsils.length > 0 && (
                <button type="button" className="text-sm text-[#dc3545]" onClick={() => setSelectedTehsils([])}>Clear all</button>
              )}
            </div>
            <div className="mb-3 flex min-h-[42px] flex-wrap gap-1 rounded border border-[#dee2e6] bg-[#f8f9fa] p-2">
              {selectedTehsils.length === 0 ? (
                <span className="text-sm italic text-ink-2">Select at least 2 tehsils from the list below</span>
              ) : (
                selectedTehsils.map((t) => (
                  <Badge key={t} bg="primary" className="p-2">
                    <span>{t}</span>
                    <span className="cursor-pointer opacity-80" onClick={() => toggle(t)}>✕</span>
                  </Badge>
                ))
              )}
            </div>
            <div className="mb-2 flex items-center gap-2">
              <label className="m-0 shrink-0 text-sm font-bold">Select Tehsils to Link</label>
              <input className="input input-sm flex-1" placeholder="Search tehsils..." value={tehsilSearch} onChange={(e) => setTehsilSearch(e.target.value)} />
            </div>
            <div className="mb-3 max-h-[180px] overflow-y-auto rounded border border-[#dee2e6] bg-white p-2">
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3">
                {filteredTehsils.map((t) => {
                  const sel = selectedTehsils.includes(t);
                  const other = alreadyLinkedMap.get(t.toLowerCase());
                  return (
                    <div
                      key={t}
                      onClick={() => !other && toggle(t)}
                      className={cn(
                        'flex min-h-[32px] items-center gap-1.5 rounded border border-[#dee2e6] bg-[#f8fafc] px-2 py-1 text-[0.8rem] transition-colors',
                        !other && 'cursor-pointer hover:border-[#94a3b8] hover:bg-[#e2e8f0]',
                        sel && 'border-[#0d6efd] bg-[#cfe2ff]',
                        other && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <input type="checkbox" className="check" checked={sel} disabled={!!other} readOnly />
                      <span className="min-w-0 flex-1 truncate">{t}</span>
                      {other && <Badge bg="secondary" className="text-[0.65rem]">In {other}</Badge>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-sm btn-secondary" onClick={resetForm}>Cancel</button>
              <button type="submit" className="btn btn-sm btn-primary" disabled={saving || selectedTehsils.length < 2 || !groupName.trim()}>
                {saving ? 'Saving...' : editingGroupId ? '💾 Save Changes' : '🔗 Link Selected Tehsils'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-ink-2">Active Alias Groups ({groups.length})</span>
            <button className="btn btn-sm btn-primary" onClick={() => { resetForm(); setIsCreatingNew(true); }}>
              <Plus size={12} /> Link Tehsils
            </button>
          </div>
          <div className="overflow-hidden rounded border border-[#dee2e6] bg-white">
            {groups.length === 0 ? (
              <div className="py-6 text-center text-sm text-ink-2">
                No linked tehsil groups yet. Click <strong>Link Tehsils</strong> to combine misspelled or duplicate tehsils.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-light table-hover text-sm">
                  <thead>
                    <tr>
                      <th className="!text-left">Group / Canonical Name</th>
                      <th className="!text-left">Linked Tehsils (Aliases)</th>
                      <th className="w-[130px] !text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g._id}>
                        <td className="font-bold text-[#0d6efd]">{g.canonicalName}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {(g.aliases || []).map((a: string) => (
                              <span key={a} className="badge bg-[#cff4fc] px-2 py-1 !text-[#055160]">{a}</span>
                            ))}
                          </div>
                        </td>
                        <td className="whitespace-nowrap text-right">
                          <button className="btn btn-sm btn-outline-primary me-1 !px-2 !py-1 min-h-[34px]" title="Edit group members" onClick={() => handleStartEdit(g)}>
                            <Pencil size={14} />
                          </button>
                          <button className="btn btn-sm btn-outline-danger !px-2 !py-1 min-h-[34px]" title="Unlink group" onClick={() => handleDeleteGroup(g)}>
                            <Unlink size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
