import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CreateOrganizationForm } from './create-organization-form';
import { DashboardAnalytics } from './dashboard-analytics';
import { DashboardWidgets } from './dashboard-widgets';
export const metadata = { title: 'App Manager Pro | Lumi' };

const approvedStatuses = ['ACCEPTED', 'APPROVED'] as const;

export default async function DashboardPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect('/login');
  const userId = session.user.id;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const previousMonthStart = new Date(monthStart);
  previousMonthStart.setMonth(previousMonthStart.getMonth() - 1);
  const chartStart = new Date(monthStart);
  chartStart.setMonth(chartStart.getMonth() - 5);

  // Promise.resolve esegue subito la query una sola volta e permette di riusarne il risultato.
  const membershipQuery = Promise.resolve(
    prisma.membership.findFirst({
      where: { userId },
      select: {
        organization: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  );
  const loadSalesStats = (organizationId: string) => {
    const quoteWhere = {
      organizationId: { in: [organizationId] },
      deletedAt: null,
    };
    return Promise.all([
      prisma.quote.groupBy({
        by: ['status'],
        where: quoteWhere,
        _count: { _all: true },
      }),
      prisma.quote.aggregate({
        where: {
          ...quoteWhere,
          status: { in: [...approvedStatuses] },
          createdAt: { gte: monthStart },
          currency: 'EUR',
        },
        _sum: { total: true },
      }),
      prisma.quote.aggregate({
        where: {
          ...quoteWhere,
          status: { in: [...approvedStatuses] },
          createdAt: { gte: previousMonthStart, lt: monthStart },
          currency: 'EUR',
        },
        _sum: { total: true },
      }),
      prisma.quote.aggregate({
        where: {
          ...quoteWhere,
          status: { in: [...approvedStatuses] },
          currency: 'EUR',
        },
        _sum: { total: true },
      }),
      prisma.quote.findMany({
        where: {
          ...quoteWhere,
          status: { in: [...approvedStatuses] },
          createdAt: { gte: chartStart },
          currency: 'EUR',
        },
        select: { createdAt: true, total: true, createdByUserId: true },
      }),
    ]);
  };
  type SalesStats = Awaited<ReturnType<typeof loadSalesStats>>;
  const noSalesStats: SalesStats = [
    [],
    { _sum: { total: null } },
    { _sum: { total: null } },
    { _sum: { total: null } },
    [],
  ];
  // Le statistiche dipendono solo dall'azienda: partono appena è nota,
  // mentre utente, note e conversazioni sono ancora in corso.
  const statsQuery = membershipQuery.then(
    (membership): Promise<SalesStats> | SalesStats =>
      membership ? loadSalesStats(membership.organization.id) : noSalesStats,
  );

  const [
    user,
    membership,
    notes,
    chats,
    [statuses, currentRevenue, previousRevenue, lifetimeApprovedValue, approvedQuotes],
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true },
    }),
    membershipQuery,
    prisma.privateNote.count({ where: { userId } }),
    prisma.chatMember.count({ where: { userId } }),
    statsQuery,
  ]);

  const organization = membership?.organization;
  // Somma dei conteggi per stato: equivale a un count() separato sugli stessi filtri.
  const quoteCount = statuses.reduce((total, item) => total + item._count._all, 0);

  const statusCounts = statuses.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = item._count._all;
    return counts;
  }, {});
  const approvedCount =
    (statusCounts.ACCEPTED ?? 0) + (statusCounts.APPROVED ?? 0);
  const currentMonthRevenue = Number(currentRevenue._sum.total ?? 0);
  const previousMonthRevenue = Number(previousRevenue._sum.total ?? 0);
  const revenueGrowth =
    previousMonthRevenue > 0
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) *
        100
      : null;
  const monthKey = (date: Date) => date.getFullYear() * 12 + date.getMonth();
  const revenueByMonth = new Map<number, { company: number; personal: number }>();
  for (const quote of approvedQuotes) {
    const key = monthKey(quote.createdAt);
    const bucket = revenueByMonth.get(key) ?? { company: 0, personal: 0 };
    const value = Number(quote.total);
    bucket.company += value;
    if (quote.createdByUserId === userId) bucket.personal += value;
    revenueByMonth.set(key, bucket);
  }
  const monthLabel = new Intl.DateTimeFormat('it-IT', { month: 'short' });
  const monthlyRevenue = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(chartStart);
    date.setMonth(chartStart.getMonth() + index);
    const bucket = revenueByMonth.get(monthKey(date));
    return {
      month: monthLabel.format(date).replace('.', ''),
      companyRevenue: bucket?.company ?? 0,
      personalRevenue: bucket?.personal ?? 0,
    };
  });
  return (
    <main className="manager-dashboard crm-dashboard">
      <header className="crm-topbar">
        <div>
          <span className="crm-eyebrow">PANORAMICA COMMERCIALE</span>
          <h1>Dashboard</h1>
        </div>
        <div className="crm-topbar-actions">
          <span className="crm-company-indicator">
            <span aria-hidden="true" />
            {organization?.name ?? 'Azienda non configurata'}
          </span>
          {organization && (
            <Link
              className="crm-primary-button"
              href={`/dashboard/preventivi?organizationId=${encodeURIComponent(organization.id)}`}
            >
              + Nuovo preventivo
            </Link>
          )}
        </div>
      </header>

      <div className="crm-greeting">
        <div>
          <p>Benvenuto, {user.name.split(' ')[0] || user.name}</p>
          <h2>Il tuo lavoro, in sintesi.</h2>
        </div>
        <Link href="/dashboard/assistente" className="crm-assistant-link">
          <span aria-hidden="true">✳</span> Chiedi a Lumi
        </Link>
      </div>

      {!organization && (
        <section className="crm-empty-state">
          <h2>Configura la tua azienda</h2>
          <p>
            I grafici sono già disponibili. Crea lo spazio aziendale per
            iniziare a vedere vendite, preventivi e clienti.
          </p>
          <CreateOrganizationForm />
        </section>
      )}

      <DashboardAnalytics
        metrics={{
          revenue: currentMonthRevenue,
          revenueGrowth,
          approvedCount,
          approvedValue: Number(lifetimeApprovedValue._sum.total ?? 0),
          conversionRate: quoteCount
            ? (approvedCount / quoteCount) * 100
            : 0,
          quoteCount,
        }}
        monthlyRevenue={monthlyRevenue}
      />

      <DashboardWidgets userId={userId} />

      <div className="crm-shortcuts">
        <Link href="/dashboard/contatti">
          <span aria-hidden="true">♙</span>
          <div><strong>Contatti</strong><small>Gestisci la rubrica clienti</small></div>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/dashboard/profilo?tab=calendar">
          <span aria-hidden="true">▦</span>
          <div><strong>Calendario</strong><small>Appuntamenti e scadenze</small></div>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/dashboard/prodotti">
          <span aria-hidden="true">◈</span>
          <div><strong>Prodotti</strong><small>Catalogo per i preventivi</small></div>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/dashboard/profilo?tab=quotes">
          <span aria-hidden="true">▧</span>
          <div><strong>Archivio</strong><small>{notes} note · {chats} conversazioni</small></div>
          <span aria-hidden="true">↗</span>
        </Link>
      </div>

    </main>
  );
}
