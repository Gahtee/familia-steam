import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Download,
  Gamepad2,
  Gift,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Medal,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  api,
  ApiError,
  assetUrl,
  imageToJpeg,
  type Member,
  type Purchase,
  type PurchaseInput,
  type RankingEntry,
  type Stats,
  type SteamResult,
  type CompareSide,
} from "@/lib/familia-api";

type View = "wrapped" | "games" | "family" | "settings";
type LoadState = "checking" | "signed-out" | "signed-in";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });

function errorText(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Não foi possível concluir a ação.";
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function MemberAvatar({ name, avatar, className }: { name: string; avatar?: string; className?: string }) {
  return (
    <Avatar className={className}>
      <AvatarImage src={assetUrl(avatar)} alt={`Foto de ${name}`} className="object-cover" />
      <AvatarFallback className="bg-surface-soft font-display text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary">
        <Gamepad2 className="size-5" aria-hidden="true" />
      </span>
      {!compact && (
        <div className="font-display text-lg font-semibold leading-tight">
          Família <span className="text-primary">Steam</span>
        </div>
      )}
    </div>
  );
}

export function FamiliaSteamApp() {
  const [auth, setAuth] = useState<LoadState>("checking");
  const [view, setView] = useState<View>("wrapped");
  const [years, setYears] = useState<number[]>([new Date().getFullYear()]);
  const [year, setYear] = useState(new Date().getFullYear());

  const checkSession = useCallback(async () => {
    try {
      await api.me();
      setAuth("signed-in");
    } catch {
      setAuth("signed-out");
    }
  }, []);

  useEffect(() => { void checkSession(); }, [checkSession]);
  useEffect(() => {
    if (auth !== "signed-in") return;
    void api.years().then((data) => {
      setYears(data.years);
      if (!data.years.includes(year)) setYear(data.years[0] ?? new Date().getFullYear());
    }).catch(() => undefined);
  }, [auth, year]);

  if (auth === "checking") return <LoadingScreen />;
  if (auth === "signed-out") return <LoginScreen onSuccess={() => setAuth("signed-in")} />;

  return (
    <AppShell view={view} onView={setView} onLogout={() => setAuth("signed-out")}>
      {view === "wrapped" && <WrappedView year={year} years={years} onYear={setYear} onAddGame={() => setView("games")} />}
      {view === "games" && <GamesView year={year} years={years} onYear={setYear} />}
      {view === "family" && <FamilyView year={year} years={years} onYear={setYear} />}
      {view === "settings" && <SettingsView year={year} years={years} onYear={setYear} onLogout={() => setAuth("signed-out")} />}
    </AppShell>
  );
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin text-primary" />
        <span>Preparando a biblioteca</span>
      </div>
    </main>
  );
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api.login(password);
      onSuccess();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="subtle-grid relative flex min-h-screen flex-col overflow-hidden px-6 py-7 sm:px-10">
      <header><Brand /></header>
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-16 py-16 lg:grid-cols-[1fr_25rem]">
        <section className="page-enter max-w-3xl">
          <h1 className="max-w-3xl font-display text-5xl font-medium leading-[1.02] sm:text-7xl lg:text-8xl">
            Um ano inteiro<br />em <span className="text-primary">jogos.</span>
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-relaxed text-muted-foreground">
            Compras, presentes e histórias da biblioteca que a família construiu junta.
          </p>
        </section>

        <form onSubmit={submit} className="page-enter border-t border-border pt-8 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <LockKeyhole className="mb-8 size-7 text-highlight" aria-hidden="true" />
          <h2 className="text-2xl font-medium">Entre em casa</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Use a senha compartilhada da família.</p>
          <div className="mt-8 space-y-2">
            <Label htmlFor="family-password">Senha</Label>
            <Input id="family-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 bg-card" required autoFocus />
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          <Button className="mt-5 h-12 w-full" disabled={pending || !password}>
            {pending && <LoaderCircle className="animate-spin" />} Entrar
          </Button>
        </form>
      </div>
      <div className="pointer-events-none absolute bottom-0 left-[15%] h-px w-[70%] bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    </main>
  );
}

const navItems: Array<{ id: View; label: string; icon: typeof BarChart3 }> = [
  { id: "wrapped", label: "Retrospectiva", icon: Sparkles },
  { id: "games", label: "Jogos", icon: Gamepad2 },
  { id: "family", label: "Família", icon: Users },
  { id: "settings", label: "Ajustes", icon: Settings },
];

function AppShell({ view, onView, onLogout, children }: { view: View; onView: (view: View) => void; onLogout: () => void; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  async function logout() {
    try { await api.logout(); } catch { /* the local session still closes */ }
    onLogout();
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border bg-sidebar px-5 py-7 lg:flex lg:flex-col">
        <Brand />
        <nav className="mt-14 space-y-1" aria-label="Navegação principal">
          {navItems.map(({ id, label, icon: Icon }) => (
            <Button key={id} variant="ghost" onClick={() => onView(id)} className={cn("h-11 w-full justify-start px-3 text-muted-foreground", view === id && "bg-sidebar-accent text-foreground")}>
              <Icon className={cn(view === id && "text-primary")} />{label}
            </Button>
          ))}
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-4">
          <Button variant="ghost" onClick={logout} className="w-full justify-start text-muted-foreground"><LogOut /> Sair</Button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur lg:hidden">
        <Brand />
        <Button size="icon" variant="ghost" onClick={() => setMobileOpen((value) => !value)} aria-label="Abrir navegação">
          {mobileOpen ? <X /> : <Menu />}
        </Button>
      </header>
      {mobileOpen && (
        <nav className="fixed inset-x-4 top-20 z-40 grid gap-1 rounded-md border border-border bg-popover p-2 shadow-xl lg:hidden">
          {navItems.map(({ id, label, icon: Icon }) => (
            <Button key={id} variant="ghost" onClick={() => { onView(id); setMobileOpen(false); }} className={cn("h-11 justify-start", view === id && "bg-accent")}><Icon />{label}</Button>
          ))}
        </nav>
      )}
      <main className="min-h-screen pb-24 lg:ml-60 lg:pb-0">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-sidebar/95 px-2 py-2 backdrop-blur lg:hidden" aria-label="Navegação principal">
        {navItems.map(({ id, label, icon: Icon }) => (
          <Button key={id} variant="ghost" onClick={() => onView(id)} className={cn("h-14 flex-col gap-1 px-1 text-[11px] text-muted-foreground", view === id && "text-primary")}><Icon className="size-5" />{label}</Button>
        ))}
      </nav>
    </div>
  );
}

function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-5 border-b border-border px-5 py-7 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-12 lg:py-10">
      <div><h1 className="text-3xl font-medium sm:text-4xl">{title}</h1><p className="mt-2 text-muted-foreground">{description}</p></div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

function YearSelect({ year, years, onYear }: { year: number; years: number[]; onYear: (year: number) => void }) {
  return (
    <Select value={String(year)} onValueChange={(value) => onYear(Number(value))}>
      <SelectTrigger className="w-28 bg-card"><CalendarDays className="mr-2 size-4 text-primary" /><SelectValue /></SelectTrigger>
      <SelectContent>{years.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function WrappedView({ year, years, onYear, onAddGame }: { year: number; years: number[]; onYear: (year: number) => void; onAddGame: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    void api.stats(year).then(setStats).catch((error) => toast.error(errorText(error))).finally(() => setLoading(false));
  }, [year]);

  if (loading) return <PageSkeleton title="Retrospectiva" />;
  if (!stats?.ready) return (
    <div className="page-enter">
      <PageHeader title="Retrospectiva" description={`A história da família em ${year}.`} actions={<YearSelect year={year} years={years} onYear={onYear} />} />
      <EmptyState icon={Sparkles} title={`Ainda não há jogos em ${year}`} description={stats?.message ?? "Registre a primeira compra para começar esta retrospectiva."} action={<Button onClick={onAddGame}><Plus /> Adicionar jogo</Button>} />
    </div>
  );

  const priciest = stats.priciest?.[0];
  return (
    <div className="page-enter">
      <PageHeader title="Retrospectiva" description={`O ano da família na Steam.`} actions={<YearSelect year={year} years={years} onYear={onYear} />} />
      <div className="px-5 sm:px-8 lg:px-12">
        <section className="relative overflow-hidden border-b border-border py-14 sm:py-20">
          <div className="absolute right-0 top-10 font-display text-[10rem] font-semibold leading-none text-border/20 sm:text-[15rem]" aria-hidden="true">{String(year).slice(2)}</div>
          <p className="relative font-display text-6xl font-medium leading-none text-primary sm:text-8xl lg:text-9xl">{stats.total}</p>
          <p className="relative mt-2 text-xl text-muted-foreground">jogos entraram para a família</p>
          <p className="relative mt-10 font-display text-3xl font-medium tabular-nums sm:text-5xl">{money.format((stats.totalCents ?? 0) / 100)}</p>
          <p className="relative mt-2 text-muted-foreground">investidos em diversão</p>
          <div className="relative mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <span><strong className="font-display text-record">{stats.giftCount}</strong> presentes</span>
            <span><strong className="font-display text-data">{stats.splitCount}</strong> jogos rachados</span>
            <span><strong className="font-display text-primary">{stats.freeCount}</strong> gratuitos</span>
            <span><strong className="font-display tabular-nums text-foreground">{money.format((stats.avgCents ?? 0) / 100)}</strong> preço médio <span className="text-muted-foreground">({stats.avgPaidCents != null ? `${money.format(stats.avgPaidCents / 100)} se considerar só os pagos` : "sem pagos no ano"})</span></span>
          </div>
        </section>

        <section className="border-b border-border py-12">
          <div className="mb-8 flex items-end justify-between"><div><h2 className="text-2xl font-medium">Compras por mês</h2><p className="mt-1 text-sm text-muted-foreground">O ritmo da biblioteca ao longo do ano.</p></div></div>
          <div className="h-72 w-full" role="img" aria-label="Gráfico de compras por mês">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.perMonth ?? []} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.55} />
                <XAxis dataKey="short" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                <Tooltip cursor={{ fill: "var(--accent)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }} formatter={(value) => [`${value} jogos`, "Compras"]} />
                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <YearPerspective stats={stats} />

        <section className="grid items-start border-b border-border lg:grid-cols-[1.15fr_.85fr]">
          <div className="py-12 lg:border-r lg:border-border lg:pr-12">
            <h2 className="text-2xl font-medium">Pódio do ano</h2>
            <div className="mt-8 space-y-1">
              <RankingRow label="Quem mais comprou" entry={stats.buyers?.[0]} tone="primary" />
              <RankingRow label="Quem mais presenteou" entry={stats.givers?.[0]} tone="highlight" />
              <RankingRow label="Quem mais gastou" entry={stats.spenders?.[0]} tone="record" moneyValue />
              <RankingRow label="Estrela dos rachados" entry={stats.splits?.[0]} tone="data" />
            </div>
            {(stats.monthlyKings?.length ?? 0) > 0 && (
              <div className="mt-12">
                <h2 className="text-2xl font-medium">Reis do mês</h2>
                <p className="mt-1 text-sm text-muted-foreground">Quem mais comprou em cada mês com movimento.</p>
                <div className="mt-6 divide-y divide-border">
                  {stats.monthlyKings?.map((kings) => (
                    <div key={kings.month} className="flex flex-col gap-3 py-4 sm:grid sm:grid-cols-[10rem_1fr_auto] sm:items-center sm:gap-4">
                      <div>
                        <p className="font-medium">{kings.label}</p>
                        <p className="text-sm text-muted-foreground">{kings.count} {kings.count === 1 ? "jogo" : "jogos"} no mês</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {kings.tops.map((top) => (
                          <span key={top.member_id} className="flex items-center gap-2 text-sm">
                            <MemberAvatar name={top.name} avatar={top.avatar} className="size-8" />
                            <span className="font-medium">{top.name}</span>
                          </span>
                        ))}
                      </div>
                      <span className="font-display tabular-nums text-muted-foreground sm:text-right" title={`${kings.topCount} ${kings.topCount === 1 ? "jogo" : "jogos"} do rei no mês`}>{kings.topCount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="py-12 lg:pl-12">
            <h2 className="text-2xl font-medium">A compra mais marcante</h2>
            {priciest ? (
              <div className="mt-7 overflow-hidden rounded-md border border-border bg-card">
                <div className="aspect-[460/215] bg-surface-soft">{priciest.header_image ? <img src={priciest.header_image} alt={`Capa de ${priciest.game_name}`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-muted-foreground"><Gamepad2 className="size-8" /><span className="sr-only">Sem capa</span></div>}</div>
                <div className="p-5"><p className="text-xl font-semibold">{priciest.game_name}</p><div className="mt-4 flex items-end justify-between gap-3"><span className="text-sm text-muted-foreground">{priciest.buyer_name}</span><span className="font-display text-2xl text-record">{money.format(priciest.cents / 100)}</span></div></div>
              </div>
            ) : <p className="mt-5 text-muted-foreground">Sem destaque neste ano.</p>}
            <h2 className="mt-12 text-2xl font-medium">O mais aguardado</h2>
            {stats.mostAnticipated ? (
              <div className="mt-7 overflow-hidden rounded-md border border-border bg-card">
                <div className="aspect-[460/215] bg-surface-soft">{stats.mostAnticipated.header_image ? <img src={stats.mostAnticipated.header_image} alt={`Capa de ${stats.mostAnticipated.game_name}`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-muted-foreground"><Gamepad2 className="size-8" /><span className="sr-only">Sem capa</span></div>}</div>
                <div className="p-5">
                  <p className="text-xl font-semibold">{stats.mostAnticipated.game_name}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-highlight/30 bg-highlight/10 text-highlight">
                      {stats.mostAnticipated.days_after_release < 0
                        ? `pré-venda: ${-stats.mostAnticipated.days_after_release} ${-stats.mostAnticipated.days_after_release === 1 ? "dia antes" : "dias antes"}`
                        : stats.mostAnticipated.days_after_release === 0
                          ? "no dia do lançamento"
                          : `${stats.mostAnticipated.days_after_release} ${stats.mostAnticipated.days_after_release === 1 ? "dia após" : "dias após"} o lançamento`}
                    </Badge>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{stats.mostAnticipated.buyer_name} · lançou em {shortDate.format(new Date(`${stats.mostAnticipated.release_date}T00:00:00Z`))}</span>
                  </div>
                </div>
              </div>
            ) : <p className="mt-5 text-muted-foreground">Sem datas de lançamento neste ano.</p>}
          </div>
        </section>

        {(stats.priciest?.length ?? 0) > 1 && <section className="py-12"><h2 className="text-2xl font-medium">Os mais caros</h2><div className="mt-6 divide-y divide-border">{stats.priciest?.slice(1).map((game, index) => <div key={game.id} className="grid grid-cols-[2rem_1fr_auto] items-center gap-4 py-4"><span className="font-display text-muted-foreground">{index + 2}</span><div><p className="font-medium">{game.game_name}</p><p className="text-sm text-muted-foreground">{game.buyer_name}</p></div><span className="font-display tabular-nums">{money.format(game.cents / 100)}</span></div>)}</div></section>}
      </div>
    </div>
  );
}

function RankingRow({ label, entry, tone, moneyValue }: { label: string; entry: RankingEntry | undefined; tone: "primary" | "highlight" | "record" | "data"; moneyValue?: boolean }) {
  if (!entry) return null;
  const toneClass = { primary: "text-primary", highlight: "text-highlight", record: "text-record", data: "text-data" }[tone];
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-border/60 py-4 last:border-0">
      <MemberAvatar name={entry.name} avatar={entry.avatar} className="size-11" />
      <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 font-semibold">{entry.name}</p></div>
      <p className={cn("font-display text-xl tabular-nums", toneClass)}>{moneyValue ? money.format((entry.cents ?? 0) / 100) : entry.value}</p>
    </div>
  );
}

function YearPerspective({ stats }: { stats: Stats }) {
  const comparison = stats.previousYearComparison;
  const gap = stats.longestGap;
  if (!comparison && !gap) return null;
  return (
    <section className="grid gap-10 border-b border-border py-12 md:grid-cols-2">
      {comparison ? (
        <div>
          <h2 className="text-2xl font-medium">Contra {comparison.previousYear}</h2>
          <p className="mt-1 text-sm text-muted-foreground">O ano lado a lado com o anterior.</p>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <span>
              <strong className={cn("font-display text-xl tabular-nums", (comparison.pctChange ?? 0) >= 0 ? "text-record" : "text-data")}>
                {comparison.pctChange == null ? "—" : `${comparison.pctChange > 0 ? "+" : ""}${String(comparison.pctChange).replace(".", ",")}%`}
              </strong>{" "}
              em gastos
            </span>
            <span className="text-muted-foreground">
              {money.format(comparison.previousTotalCents / 100)} em {comparison.previousYear} · {comparison.previousTotalGames} jogos
            </span>
          </div>
        </div>
      ) : <div />}
      {gap ? (
        <div>
          <h2 className="text-2xl font-medium">A maior pausa</h2>
          <p className="mt-1 text-sm text-muted-foreground">O intervalo mais longo sem compras no ano.</p>
          <p className="mt-6 font-display text-xl tabular-nums">
            {gap.days} {gap.days === 1 ? "dia" : "dias"}
            <span className="ml-3 text-sm font-normal text-muted-foreground">
              {shortDate.format(new Date(`${gap.from}T00:00:00Z`))} → {shortDate.format(new Date(`${gap.to}T00:00:00Z`))}
            </span>
          </p>
        </div>
      ) : <div />}
    </section>
  );
}

function GamesView({ year, years, onYear }: { year: number; years: number[]; onYear: (year: number) => void }) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [member, setMember] = useState("all");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [gamesData, membersData] = await Promise.all([api.purchases(year, member === "all" ? undefined : Number(member), query || undefined), api.members()]);
      setPurchases(gamesData.purchases);
      setMembers(membersData.members);
    } catch (error) { toast.error(errorText(error)); }
    finally { setLoading(false); }
  }, [year, member, query]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  async function remove(game: Purchase) {
    if (!window.confirm(`Excluir “${game.game_name}”?`)) return;
    try { await api.deletePurchase(game.id); toast.success("Jogo excluído."); await load(); } catch (error) { toast.error(errorText(error)); }
  }

  return (
    <div className="page-enter">
      <PageHeader title="Jogos" description={`${purchases.length} ${purchases.length === 1 ? "compra encontrada" : "compras encontradas"}.`} actions={<><YearSelect year={year} years={years} onYear={onYear} /><Button variant="outline" onClick={() => void api.exportCsv(year).catch((error) => toast.error(errorText(error)))}><Download /> CSV</Button><Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus /> Adicionar</Button></>} />
      <div className="px-5 sm:px-8 lg:px-12">
        <div className="grid gap-3 border-b border-border py-6 md:grid-cols-[1fr_14rem]">
          <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Buscar jogos" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por jogo, pessoa ou nota" className="h-11 bg-card pl-10" /></div>
          <Select value={member} onValueChange={setMember}><SelectTrigger className="h-11 bg-card"><SelectValue placeholder="Todos da família" /></SelectTrigger><SelectContent><SelectItem value="all">Todos da família</SelectItem>{members.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select>
        </div>
        {loading ? <RowsSkeleton /> : purchases.length === 0 ? <EmptyState icon={Search} title="Nenhum jogo encontrado" description="Ajuste a busca ou registre uma nova compra." /> : (
          <div className="divide-y divide-border">
            {purchases.map((game) => (
              <article key={game.id} className="group grid grid-cols-[5rem_1fr_auto] gap-4 py-5 sm:grid-cols-[8rem_1fr_auto] sm:gap-6">
                <div className="aspect-[460/215] overflow-hidden rounded-sm bg-surface-soft">{game.header_image ? <img src={game.header_image} alt={`Capa de ${game.game_name}`} loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-muted-foreground"><Gamepad2 className="size-5" /><span className="sr-only">Sem capa</span></div>}</div>
                <div className="min-w-0 self-center"><h2 className="truncate text-base font-semibold sm:text-lg">{game.game_name}</h2><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{game.buyer_name}</span><span>{shortDate.format(new Date(`${game.purchase_date}T00:00:00Z`))}</span>{Boolean(game.is_gift) && <Badge className="border-highlight/30 bg-highlight/10 text-highlight" variant="outline"><Gift className="mr-1 size-3" /> para {game.gift_to_name}</Badge>}{game.splits.length > 0 && <Badge variant="outline">Rachado com {game.splits.map((item) => item.name).join(", ")}</Badge>}</div>{game.note && <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{game.note}</p>}</div>
                <div className="flex flex-col items-end justify-between gap-2"><span className="font-display text-base tabular-nums sm:text-lg">{money.format(game.price_paid_cents / 100)}</span><div className="flex"><Button size="icon" variant="ghost" aria-label={`Editar ${game.game_name}`} onClick={() => { setEditing(game); setDialogOpen(true); }}><Pencil /></Button><Button size="icon" variant="ghost" aria-label={`Excluir ${game.game_name}`} onClick={() => void remove(game)}><Trash2 /></Button></div></div>
              </article>
            ))}
          </div>
        )}
      </div>
      <GameDialog open={dialogOpen} onOpenChange={setDialogOpen} members={members} purchase={editing} onSaved={load} />
    </div>
  );
}

function GameDialog({ open, onOpenChange, members, purchase, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; members: Member[]; purchase: Purchase | null; onSaved: () => Promise<void> }) {
  const empty = useMemo(() => ({ game_name: "", appid: "", steam_url: "", header_image: "", buyer_member_id: members[0]?.id ?? 0, purchase_date: new Date().toISOString().slice(0, 10), price: "", is_gift: false, gift_to_member_id: "", split_with: [] as number[], note: "" }), [members]);
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SteamResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResults([]); setSearch("");
    setForm(purchase ? { game_name: purchase.game_name, appid: purchase.appid ? String(purchase.appid) : "", steam_url: purchase.steam_url, header_image: purchase.header_image, buyer_member_id: purchase.buyer_member_id, purchase_date: purchase.purchase_date, price: (purchase.price_paid_cents / 100).toFixed(2).replace(".", ","), is_gift: Boolean(purchase.is_gift), gift_to_member_id: purchase.gift_to_member_id ? String(purchase.gift_to_member_id) : "", split_with: purchase.splits.map((item) => item.id), note: purchase.note } : empty);
  }, [open, purchase, empty]);

  async function searchSteam() {
    if (search.trim().length < 2) return;
    setSearching(true);
    try { setResults((await api.searchSteam(search.trim())).results); } catch (error) { toast.error(errorText(error)); }
    finally { setSearching(false); }
  }
  async function chooseSteam(item: SteamResult) {
    try {
      const detail = await api.lookupSteam(item.appid);
      setForm((current) => ({ ...current, appid: String(detail.appid), game_name: detail.name, header_image: detail.header_image, steam_url: `https://store.steampowered.com/app/${detail.appid}/`, price: detail.current_price_cents == null ? current.price : (detail.current_price_cents / 100).toFixed(2).replace(".", ",") }));
      setResults([]); setSearch("");
    } catch (error) { toast.error(errorText(error)); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true);
    const payload: PurchaseInput = { appid: form.appid, steam_url: form.steam_url, game_name: form.game_name, header_image: form.header_image, buyer_member_id: form.buyer_member_id, purchase_date: form.purchase_date, price_paid_cents: Math.round(Number(form.price.replace(",", ".")) * 100), price_source: "manual", is_gift: form.is_gift, gift_to_member_id: form.is_gift ? Number(form.gift_to_member_id) : null, split_with: form.split_with, note: form.note };
    try { if (purchase) await api.updatePurchase(purchase.id, payload); else await api.addPurchase(payload); toast.success(purchase ? "Jogo atualizado." : "Jogo adicionado."); onOpenChange(false); await onSaved(); } catch (error) { toast.error(errorText(error)); } finally { setPending(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{purchase ? "Editar compra" : "Adicionar jogo"}</DialogTitle><DialogDescription>Busque na Steam ou preencha os dados manualmente.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-6">
          {!purchase && <div className="rounded-md border border-border bg-card p-4"><Label htmlFor="steam-search">Buscar na Steam</Label><div className="mt-2 flex gap-2"><Input id="steam-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome do jogo" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchSteam(); } }} /><Button type="button" variant="secondary" onClick={() => void searchSteam()} disabled={searching}>{searching ? <LoaderCircle className="animate-spin" /> : <Search />}</Button></div>{results.length > 0 && <div className="mt-3 max-h-48 divide-y divide-border overflow-y-auto">{results.map((item) => <Button type="button" variant="ghost" key={item.appid} onClick={() => void chooseSteam(item)} className="h-auto w-full justify-start rounded-none px-0 py-3 text-left"><img src={item.tiny_image} alt="" className="h-9 w-16 rounded-sm object-cover" /><span className="min-w-0 flex-1 truncate text-sm">{item.name}</span><span className="text-xs text-muted-foreground">{item.price_cents == null ? "Sem preço" : money.format(item.price_cents / 100)}</span><ChevronRight className="size-4" /></Button>)}</div>}</div>}
          <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Label htmlFor="game-name">Nome do jogo</Label><Input id="game-name" className="mt-2" value={form.game_name} onChange={(e) => setForm({ ...form, game_name: e.target.value })} required /></div><div><Label>Quem comprou</Label><Select value={String(form.buyer_member_id || "")} onValueChange={(value) => setForm({ ...form, buyer_member_id: Number(value) })}><SelectTrigger className="mt-2"><SelectValue placeholder="Escolha" /></SelectTrigger><SelectContent>{members.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="purchase-date">Data</Label><Input id="purchase-date" type="date" className="mt-2" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} required /></div><div><Label htmlFor="price">Preço pago (R$)</Label><Input id="price" inputMode="decimal" className="mt-2" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="59,99" required /></div><div><Label htmlFor="steam-url">Link da Steam</Label><Input id="steam-url" type="url" className="mt-2" value={form.steam_url} onChange={(e) => setForm({ ...form, steam_url: e.target.value })} /></div><div className="sm:col-span-2"><Label htmlFor="cover-url">URL da capa</Label><Input id="cover-url" type="url" className="mt-2" value={form.header_image} onChange={(e) => setForm({ ...form, header_image: e.target.value })} /></div></div>
          <div className="space-y-4 border-y border-border py-5"><label className="flex items-center gap-3 text-sm"><Checkbox checked={form.is_gift} onCheckedChange={(checked) => setForm({ ...form, is_gift: Boolean(checked) })} />Foi um presente</label>{form.is_gift && <div><Label>Para quem?</Label><Select value={form.gift_to_member_id} onValueChange={(value) => setForm({ ...form, gift_to_member_id: value })}><SelectTrigger className="mt-2"><SelectValue placeholder="Escolha" /></SelectTrigger><SelectContent>{members.filter((item) => item.id !== form.buyer_member_id).map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>}<div><Label>Rachado com</Label><div className="mt-3 flex flex-wrap gap-2">{members.filter((item) => item.id !== form.buyer_member_id).map((item) => { const active = form.split_with.includes(item.id); return <Button key={item.id} type="button" size="sm" variant={active ? "default" : "outline"} onClick={() => setForm({ ...form, split_with: active ? form.split_with.filter((id) => id !== item.id) : [...form.split_with, item.id] })}>{active && <Check />}{item.name}</Button>; })}</div></div></div>
          <div><Label htmlFor="note">Nota</Label><Textarea id="note" className="mt-2" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Promoção, ocasião ou lembrança" /></div>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={pending || !form.game_name || !form.buyer_member_id}>{pending && <LoaderCircle className="animate-spin" />}{purchase ? "Salvar mudanças" : "Adicionar jogo"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FamilyView({ year, years, onYear }: { year: number; years: number[]; onYear: (year: number) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const load = useCallback(async () => { setLoading(true); try { setMembers((await api.members(year)).members); } catch (error) { toast.error(errorText(error)); } finally { setLoading(false); } }, [year]);
  useEffect(() => { void load(); }, [load]);
  async function remove(member: Member) { if (!window.confirm(`Excluir ${member.name}?`)) return; try { await api.deleteMember(member.id); toast.success("Membro excluído."); await load(); } catch (error) { toast.error(errorText(error)); } }
  return (
    <div className="page-enter">
      <PageHeader title="Família" description={`As pessoas por trás da biblioteca em ${year}.`} actions={<><YearSelect year={year} years={years} onYear={onYear} /><Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus /> Novo membro</Button></>} />
      <div className="px-5 sm:px-8 lg:px-12">{loading ? <RowsSkeleton /> : members.length === 0 ? <EmptyState icon={Users} title="A família começa aqui" description="Cadastre alguém antes de registrar o primeiro jogo." action={<Button onClick={() => setDialogOpen(true)}><Plus /> Novo membro</Button>} /> : <><div className="divide-y divide-border">{members.map((member, index) => <article key={member.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-5 py-7 sm:gap-8"><div className="relative"><MemberAvatar name={member.name} avatar={member.avatar_url} className="size-16 sm:size-20" /><span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-card font-display text-xs text-muted-foreground">{index + 1}</span></div><div><h2 className="text-xl font-semibold sm:text-2xl">{member.name}</h2>{(member.badges?.length ?? 0) > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{member.badges?.map((badge) => <Badge key={badge} variant="outline" className="border-primary/30 bg-primary/10 text-primary"><Medal className="mr-1 size-3" />{badge}</Badge>)}</div>}<div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground"><span><strong className="text-foreground">{member.bought}</strong> compras</span><span><strong className="text-highlight">{member.gifted}</strong> presentes</span><span><strong className="text-data">{member.split_in}</strong> rachados</span><span><strong className="font-display tabular-nums text-record">{money.format((member.spent_cents ?? 0) / 100)}</strong> gastos</span></div></div><div className="flex"><Button size="icon" variant="ghost" onClick={() => { setEditing(member); setDialogOpen(true); }} aria-label={`Editar ${member.name}`}><Pencil /></Button><Button size="icon" variant="ghost" onClick={() => void remove(member)} aria-label={`Excluir ${member.name}`}><Trash2 /></Button></div></article>)}</div>{members.length >= 2 && <CompareSection members={members} year={year} />}</>}</div>
      <MemberDialog open={dialogOpen} onOpenChange={setDialogOpen} member={editing} onSaved={load} />
    </div>
  );
}

function MemberDialog({ open, onOpenChange, member, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; member: Member | null; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(""); const [pending, setPending] = useState(false); const inputRef = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent) { event.preventDefault(); setPending(true); try { if (member) await api.updateMember(member.id, name); else await api.addMember(name); toast.success(member ? "Membro atualizado." : "Membro adicionado."); onOpenChange(false); await onSaved(); } catch (error) { toast.error(errorText(error)); } finally { setPending(false); } }
  async function upload(file?: File) { if (!member || !file) return; setPending(true); try { const data = await imageToJpeg(file); await api.uploadAvatar(member.id, data); toast.success("Foto atualizada."); await onSaved(); onOpenChange(false); } catch (error) { toast.error(errorText(error)); } finally { setPending(false); } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{member ? `Editar ${member.name}` : "Novo membro"}</DialogTitle><DialogDescription>O nome aparece nas compras e nos rankings.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-6">{member && <div className="flex items-center gap-5"><MemberAvatar name={member.name} avatar={member.avatar_url} className="size-20" /><div><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} /><Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={pending}><Camera /> Trocar foto</Button><p className="mt-2 text-xs text-muted-foreground">JPG, PNG, WebP ou GIF. A imagem será reduzida.</p></div></div>}<div><Label htmlFor="member-name">Nome</Label><Input id="member-name" className="mt-2" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus required /></div><DialogFooter><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={pending || !name.trim()}>{pending && <LoaderCircle className="animate-spin" />}Salvar</Button></DialogFooter></form></DialogContent></Dialog>;
}

function CompareSection({ members, year }: { members: Member[]; year: number }) {
  const [aid, setAid] = useState(members[0]?.id ?? 0);
  const [bid, setBid] = useState(members[1]?.id ?? members[0]?.id ?? 0);
  const [result, setResult] = useState<{ a: CompareSide; b: CompareSide } | null>(null);
  // com 2 membros, trocar A pula B para o outro (sem cair de volta no A);
  // com 3+, B vai para o primeiro diferente de A.
  function pickA(id: number) {
    setAid(id);
    if (id === bid) setBid(members.find((item) => item.id !== id)?.id ?? id);
  }
  useEffect(() => {
    if (!aid || !bid || aid === bid) return;
    void api.compareMembers(aid, bid, year).then(setResult).catch((error) => toast.error(errorText(error)));
  }, [aid, bid, year]);
  const rows: Array<{ label: string; a: string; b: string }> = result ? [
    { label: "Jogos", a: String(result.a.bought), b: String(result.b.bought) },
    { label: "Gastos", a: money.format(result.a.cents / 100), b: money.format(result.b.cents / 100) },
    { label: "Presentes", a: `${result.a.gifted} (${money.format(result.a.gifted_cents / 100)})`, b: `${result.b.gifted} (${money.format(result.b.gifted_cents / 100)})` },
    { label: "Recebidos", a: `${result.a.received} (${money.format(result.a.received_cents / 100)})`, b: `${result.b.received} (${money.format(result.b.received_cents / 100)})` },
    { label: "Rachas", a: `${result.a.splits} (${result.a.splits_started}+${result.a.splits_joined})`, b: `${result.b.splits} (${result.b.splits_started}+${result.b.splits_joined})` },
  ] : [];
  return (
    <section className="border-t border-border py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="text-2xl font-medium">Comparar membros</h2><p className="mt-1 text-sm text-muted-foreground">Lado a lado em {year}.</p></div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={String(aid)} onValueChange={(value) => pickA(Number(value))}><SelectTrigger className="bg-card"><SelectValue /></SelectTrigger><SelectContent>{members.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select>
          <Select value={String(bid)} onValueChange={(value) => setBid(Number(value))}><SelectTrigger className="bg-card"><SelectValue /></SelectTrigger><SelectContent>{members.filter((item) => item.id !== aid).map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select>
        </div>
      </div>
      {result && (
        <div className="mt-6">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 pb-4">
            <span />
            {[result.a, result.b].map((side) => (
              <span key={side.id} className="flex w-24 flex-col items-center gap-1.5 sm:w-32">
                <MemberAvatar name={side.name} avatar={side.avatar_url} className="size-8" />
                <span className="max-w-full truncate text-sm font-semibold">{side.name}</span>
              </span>
            ))}
          </div>
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-3">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="w-24 text-center font-display tabular-nums sm:w-32">{row.a}</span>
                <span className="w-24 text-center font-display tabular-nums sm:w-32">{row.b}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsView({ year, years, onYear, onLogout }: { year: number; years: number[]; onYear: (year: number) => void; onLogout: () => void }) {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [confirm, setConfirm] = useState(""); const [pending, setPending] = useState(false);
  async function changePassword(event: FormEvent) { event.preventDefault(); if (next !== confirm) { toast.error("As novas senhas não coincidem."); return; } setPending(true); try { await api.changePassword(current, next); setCurrent(""); setNext(""); setConfirm(""); toast.success("Senha atualizada. As outras sessões foram encerradas."); } catch (error) { toast.error(errorText(error)); } finally { setPending(false); } }
  async function logout() { try { await api.logout(); } finally { onLogout(); } }
  return <div className="page-enter"><PageHeader title="Ajustes" description="Segurança, dados e sessão." /><div className="mx-auto max-w-4xl px-5 sm:px-8 lg:px-12"><section className="grid gap-8 border-b border-border py-10 md:grid-cols-[15rem_1fr]"><div><ShieldCheck className="mb-4 size-6 text-primary" /><h2 className="text-xl font-medium">Senha da família</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Ao trocar, todas as outras sessões serão encerradas.</p></div><form onSubmit={changePassword} className="space-y-4"><div><Label htmlFor="current-password">Senha atual</Label><Input id="current-password" type="password" className="mt-2" value={current} onChange={(e) => setCurrent(e.target.value)} required /></div><div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="new-password">Nova senha</Label><Input id="new-password" type="password" minLength={8} maxLength={128} className="mt-2" value={next} onChange={(e) => setNext(e.target.value)} required /></div><div><Label htmlFor="confirm-password">Confirmar senha</Label><Input id="confirm-password" type="password" minLength={8} maxLength={128} className="mt-2" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div></div><Button disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}Atualizar senha</Button></form></section><NextSaleSection /><section className="grid gap-8 border-b border-border py-10 md:grid-cols-[15rem_1fr]"><div><Download className="mb-4 size-6 text-data" /><h2 className="text-xl font-medium">Exportar dados</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Baixe as compras de um ano em formato CSV.</p></div><div className="flex max-w-sm gap-2"><YearSelect year={year} years={years} onYear={onYear} /><Button variant="outline" onClick={() => void api.exportCsv(year).catch((error) => toast.error(errorText(error)))}><Download /> Baixar CSV</Button></div></section><section className="grid gap-8 py-10 md:grid-cols-[15rem_1fr]"><div><LogOut className="mb-4 size-6 text-highlight" /><h2 className="text-xl font-medium">Sessão</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Saia deste dispositivo com segurança.</p></div><div><Button variant="outline" onClick={() => void logout()}><LogOut /> Sair da Família Steam</Button></div></section></div></div>;
}

const saleCountdown = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

function NextSaleSection() {
  const [saleAt, setSaleAt] = useState("");
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState<{ next_sale_at: string | null; label: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void api.nextSale()
      .then((data) => {
        setSaved(data);
        setSaleAt(data.next_sale_at ? data.next_sale_at.slice(0, 16) : "");
        setLabel(data.label ?? "");
      })
      .catch((error) => toast.error(errorText(error)))
      .finally(() => setLoading(false));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      // datetime-local entrega "2026-12-18T00:00"; backend normaliza para ISO.
      // Vazio = null (limpa o temporizador).
      const data = await api.updateNextSale(saleAt ? new Date(`${saleAt}:00`).toISOString() : null, label.trim());
      setSaved(data);
      toast.success(saleAt ? "Promoção salva." : "Temporizador limpo.");
    } catch (error) { toast.error(errorText(error)); }
    finally { setPending(false); }
  }
  const target = saved?.next_sale_at ? new Date(saved.next_sale_at).getTime() : null;
  const daysLeft = target == null ? null : Math.max(0, Math.ceil((target - Date.now()) / 86400000));
  return (
    <section className="grid gap-8 border-b border-border py-10 md:grid-cols-[15rem_1fr]">
      <div><CalendarDays className="mb-4 size-6 text-highlight" /><h2 className="text-xl font-medium">Próxima promoção</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Contagem regressiva para a próxima sale da Steam.</p></div>
      <div>
        {loading ? <Skeleton className="h-24 w-full max-w-sm" /> : (
          <form onSubmit={submit} className="max-w-sm space-y-4">
            {saved?.next_sale_at && daysLeft != null && (
              <p className="text-sm text-muted-foreground">
                <strong className="font-display text-xl tabular-nums text-primary">{daysLeft} {daysLeft === 1 ? "dia" : "dias"}</strong>{" "}
                para {saved.label || "a promoção"} · {saleCountdown.format(new Date(saved.next_sale_at))}
              </p>
            )}
            {!saved?.next_sale_at && <p className="text-sm text-muted-foreground">Nenhuma promoção marcada.</p>}
            <div><Label htmlFor="next-sale-date">Data e hora</Label><Input id="next-sale-date" type="datetime-local" className="mt-2" value={saleAt} onChange={(e) => setSaleAt(e.target.value)} /></div>
            <div><Label htmlFor="next-sale-label">Nome <span className="text-muted-foreground">(opcional)</span></Label><Input id="next-sale-label" className="mt-2" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Promoção de Inverno" /></div>
            <div className="flex gap-2">
              <Button disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}Salvar</Button>
              {saved?.next_sale_at && <Button type="button" variant="outline" disabled={pending} onClick={() => { setSaleAt(""); setLabel(""); }}>Limpar</Button>}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function PageSkeleton({ title }: { title: string }) { return <div><PageHeader title={title} description="Carregando as memórias da família." /><div className="space-y-8 px-5 py-10 sm:px-8 lg:px-12"><Skeleton className="h-44 w-full" /><Skeleton className="h-72 w-full" /><div className="grid gap-5 md:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div></div></div>; }
function RowsSkeleton() { return <div className="space-y-1 py-4">{[1,2,3,4].map((item) => <div key={item} className="flex items-center gap-5 border-b border-border py-5"><Skeleton className="h-16 w-28" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-1/2" /></div></div>)}</div>; }
function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Gamepad2; title: string; description: string; action?: React.ReactNode }) { return <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center"><span className="grid size-14 place-items-center rounded-full bg-surface-soft text-primary"><Icon className="size-6" /></span><h2 className="mt-6 text-2xl font-medium">{title}</h2><p className="mt-2 leading-relaxed text-muted-foreground">{description}</p>{action && <div className="mt-6">{action}</div>}</div>; }