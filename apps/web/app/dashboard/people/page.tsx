"use client";
import { useEffect, useState } from "react";
import { Upload, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { DataTable, Drawer, Money, StatusPill, TableToolbar } from "@/components/finance";
import { useToast } from "@/components/toast";
import { api, humanError, useAsync } from "@/lib/settle";
import { useBiz } from "../context";

type Tab = "active" | "inactive";
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export default function People() {
  const [tab, setTab] = useState<Tab>("active");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const list = useAsync(() => api().request("GET", "/v1/people"), []);
  const all: any[] = list.data?.data ?? [];
  const rows = list.data ? all.filter((p) => (tab === "active" ? p.active : !p.active) && (!q || `${p.name} ${p.email ?? ""} ${p.title ?? ""}`.toLowerCase().includes(q.toLowerCase()))) : undefined;
  return (
    <>
      <PageHeader
        title="People"
        description="Employees and contractors you pay. Each person gets paid to their own NEAR account."
        action={
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="size-4" aria-hidden /> Import CSV
            </Button>
            <Button onClick={() => setEditing({})}>
              <UserPlus className="size-4" aria-hidden /> Add person
            </Button>
          </>
        }
      />
      <Card>
        <TableToolbar tabs={[{ value: "active", label: "Active" }, { value: "inactive", label: "Archived" }]} tab={tab} onTab={setTab} counts={{ active: all.filter((p) => p.active).length, inactive: all.filter((p) => !p.active).length }} search={q} onSearch={setQ} searchLabel="Search people" />
        <DataTable
          rows={rows}
          loading={list.loading}
          error={list.error}
          retry={list.reload}
          rowKey={(p: any) => p.id}
          onRowClick={setEditing}
          defaultSort={{ key: "name", dir: "asc" }}
          empty={{ icon: <Users className="size-4" aria-hidden />, title: tab === "active" ? "No people yet" : "No archived people", body: tab === "active" ? "Add your team to run payroll and start salary streams." : undefined, action: tab === "active" ? <Button onClick={() => setEditing({})}><UserPlus className="size-4" aria-hidden /> Add person</Button> : undefined }}
          columns={[
            { key: "name", header: "Name", render: (p: any) => <div className="min-w-0"><p className="truncate font-medium">{p.name}</p>{p.email && <p className="truncate text-xs text-muted-foreground">{p.email}</p>}</div>, sortValue: (p: any) => p.name.toLowerCase() },
            { key: "title", header: "Role", render: (p: any) => <span className="text-muted-foreground">{p.title ?? "—"}</span> },
            { key: "type", header: "Type", render: (p: any) => <StatusPill status={p.type === "contractor" ? "open" : "active"}>{p.type === "contractor" ? "Contractor" : "Employee"}</StatusPill> },
            { key: "to", header: "Pays to", render: (p: any) => <span className="block max-w-52 truncate font-mono text-xs">{p.near_account ?? <span className="text-warning">Missing account</span>}</span> },
            { key: "pay", header: "Regular pay", align: "right", render: (p: any) => (p.default_amount ? <Money v={p.default_amount} /> : <span className="text-muted-foreground">—</span>), sortValue: (p: any) => Number(p.default_amount ?? 0) },
            { key: "ytd", header: "Paid YTD", align: "right", render: (p: any) => <Money v={p.paid_ytd} muted={Number(p.paid_ytd) === 0} />, sortValue: (p: any) => Number(p.paid_ytd) },
          ]}
        />
      </Card>
      <PersonDrawer person={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
      <ImportDrawer open={importing} onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); }} />
    </>
  );
}

function PersonDrawer({ person, onClose, onSaved }: { person: any | null; onClose: () => void; onSaved: () => void }) {
  const { cfg } = useBiz();
  const toast = useToast();
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setF({ type: "employee", ...(person ?? {}) });
    setError(null);
  }, [person]);
  if (!person) return null;
  const isNew = !person.id;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const acctErr = f.near_account && !ACCOUNT_RE.test(f.near_account) ? "Not a valid NEAR account" : null;
  const amtErr = f.default_amount && !/^\d+(\.\d{1,6})?$/.test(f.default_amount) ? "Enter an amount like 4000 or 4000.50" : null;

  async function save(patch?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const payload = patch ?? { name: f.name, email: f.email || null, near_account: f.near_account || null, title: f.title || null, type: f.type, default_amount: f.default_amount || null };
      if (isNew) await api().request("POST", "/v1/people", payload);
      else await api().request("PATCH", `/v1/people/${person.id}`, payload);
      toast({ kind: "success", title: isNew ? `${f.name} added` : patch ? (patch.active ? "Restored" : "Archived") : "Saved" });
      onSaved();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? "Add person" : person.name}
      actions={
        <>
          {!isNew && <Button variant="ghost" className="mr-auto" loading={busy} onClick={() => save({ active: !person.active })}>{person.active ? "Archive" : "Restore"}</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="person" loading={busy} disabled={!f.name || !!acctErr || !!amtErr}>{isNew ? "Add person" : "Save"}</Button>
        </>
      }
    >
      <form id="person" onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-4">
        <Field label="Full name">{(p) => <Input {...p} required value={f.name ?? ""} onChange={set("name")} autoComplete="off" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">{(p) => <Input {...p} value={f.title ?? ""} onChange={set("title")} placeholder="Head baker" />}</Field>
          <Field label="Type">
            {(p) => (
              <Select {...p} value={f.type} onChange={set("type")}>
                <option value="employee">Employee</option>
                <option value="contractor">Contractor</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Email">{(p) => <Input {...p} type="email" value={f.email ?? ""} onChange={set("email")} autoComplete="off" />}</Field>
        <Field label="NEAR account" hint={`Where their pay goes. They can create one free at /wallet (e.g. alice.${cfg.account_suffix}).`} error={acctErr}>
          {(p) => <Input {...p} value={f.near_account ?? ""} onChange={(e) => setF({ ...f, near_account: e.target.value.trim().toLowerCase() })} className="font-mono text-[13px]" spellCheck={false} />}
        </Field>
        <Field label="Regular pay per run (USD)" error={amtErr}>{(p) => <Input {...p} inputMode="decimal" value={f.default_amount ?? ""} onChange={set("default_amount")} placeholder="4000" className="tnum" />}</Field>
        {error && <p role="alert" className="rounded-xl bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}
      </form>
    </Drawer>
  );
}

function ImportDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Import people"
      subtitle="Paste a CSV straight from your spreadsheet or HR tool."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy}
            disabled={csv.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api().request("POST", "/v1/people/import", { csv });
                setErrors(r.errors);
                toast({ kind: r.created ? "success" : "error", title: `Imported ${r.created} ${r.created === 1 ? "person" : "people"}`, body: r.errors.length ? `${r.errors.length} line(s) skipped` : undefined });
                if (!r.errors.length) {
                  setCsv("");
                  onDone();
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            Import
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="CSV" hint="Columns: name, email, near_account, amount, role (header row optional)">
          {(p) => <Textarea {...p} value={csv} onChange={(e) => setCsv(e.target.value)} className="min-h-56 font-mono text-[13px]" placeholder={"name,email,near_account,amount,role\nAlice Romero,alice@rosas.co,alice.near,3200,Head baker"} spellCheck={false} />}
        </Field>
        {errors.length > 0 && <ul className="rounded-xl bg-warning-soft px-4 py-2 text-xs text-warning">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </div>
    </Drawer>
  );
}
