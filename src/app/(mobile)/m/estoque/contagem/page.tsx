import Link from "next/link";
import { ClipboardList, ChevronRight } from "lucide-react";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadInventarios, type InventarioView } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { Badge, Card } from "@/components/ui/misc";

/**
 * Inventários para contar. Criar inventário continua no computador — definir
 * escopo, categoria e recorrência é trabalho de mesa. O celular faz a parte
 * que só se faz de pé: contar.
 *
 * A lista inclui os PROGRAMADOS, não só os já abertos: quem programou a
 * contagem no computador espera achá-la no celular na hora de contar, e um
 * inventário que só aparece depois de "iniciado" em outra tela nunca chegava
 * aqui. Quem inicia é a própria tela de contagem, no primeiro item contado.
 *
 * A ordem das seções é a da urgência: o que está em andamento (alguém parou no
 * meio), o que passou da data, o de hoje, e só então os futuros.
 */
export default async function ContagemListaPage() {
  const ctx = await requirePermissaoMobile("estoque.inventario");

  const inventarios = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const todos = await loadInventarios(siteId);
    return todos.filter((i) => i.status === "ABERTO" || i.status === "PROGRAMADO");
  });

  const emAndamento = inventarios.filter((i) => i.status === "ABERTO");
  const programados = inventarios
    .filter((i) => i.status === "PROGRAMADO")
    .sort(
      (a, b) =>
        new Date(a.dataProgramada).getTime() - new Date(b.dataProgramada).getTime(),
    );

  const atrasados = programados.filter((i) => diasDeAtraso(i.dataProgramada) > 0);
  const hoje = programados.filter((i) => diasDeAtraso(i.dataProgramada) === 0);
  const futuros = programados.filter((i) => diasDeAtraso(i.dataProgramada) < 0);

  const vazio = inventarios.length === 0;

  return (
    <>
      <MobilePageHeader titulo="Contagem" descricao="Inventários para contar." />

      {vazio ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <ClipboardList className="h-8 w-8 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">
            Nenhum inventário aberto
          </p>
          <p className="text-sm text-ink-2">
            Programe um inventário no computador e ele aparece aqui para contar.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          <Secao titulo="Em andamento" itens={emAndamento} />
          <Secao titulo="Atrasados" itens={atrasados} />
          <Secao titulo="Para hoje" itens={hoje} />
          <Secao titulo="Próximos" itens={futuros} />
        </div>
      )}
    </>
  );
}

/**
 * Dias de atraso em relação a hoje, comparando datas em UTC — `dataProgramada`
 * é uma data sem hora, e converter para o fuso local jogaria a meia-noite para
 * o dia anterior, marcando de atrasado o inventário que é para hoje.
 */
function diasDeAtraso(dataProgramada: string | Date): number {
  const d = new Date(dataProgramada);
  const alvo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const agora = new Date();
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  return Math.round((hoje - alvo) / 86_400_000);
}

function Secao({ titulo, itens }: { titulo: string; itens: InventarioView[] }) {
  if (itens.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold tracking-wider text-faint uppercase">
        {titulo}
      </h2>
      <ul className="space-y-2">
        {itens.map((i) => (
          <li key={i.id}>
            <LinhaInventario inv={i} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LinhaInventario({ inv }: { inv: InventarioView }) {
  const contados = inv.items.filter((it) => it.qtdContada != null).length;
  const total = inv.items.length || inv.qtdProdutos;
  const atraso = diasDeAtraso(inv.dataProgramada);

  return (
    <Link href={`/m/estoque/contagem/${inv.id}`}>
      <Card className="flex items-center gap-3 p-4 hover:bg-surface-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{inv.escopoLabel}</p>
          <p className="truncate text-xs text-muted">
            {inv.siteNome} · {new Date(inv.dataProgramada).toLocaleDateString("pt-BR")}
          </p>
          <p className="mt-1 text-xs text-ink-2">
            {inv.status === "ABERTO"
              ? `${contados} de ${total} contados`
              : `${total} ${total === 1 ? "produto" : "produtos"} para contar`}
          </p>
        </div>
        {inv.modoCego && <Badge tone="accent">Cego</Badge>}
        {inv.status === "ABERTO" ? (
          <Badge tone="brand">Em andamento</Badge>
        ) : atraso > 0 ? (
          <Badge tone="danger">
            {atraso === 1 ? "1 dia atrasado" : `${atraso} dias atrasado`}
          </Badge>
        ) : atraso === 0 ? (
          <Badge tone="warn">Hoje</Badge>
        ) : (
          <Badge tone="neutral">Programado</Badge>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      </Card>
    </Link>
  );
}
