import "server-only";
import { db } from "@/lib/prisma";

// ============================================================
// Renomeou uma categoria (ou marca, ou fornecedor)? Os relatórios salvos que
// filtravam por ela precisam saber.
//
// O motor de relatórios filtra essas dimensões por NOME, não por id — ver
// `carregarOpcoes` em lib/relatorios/fontes.ts, que devolve
// `{ valor: c.nome }`. É escolha deliberada (o nome é o que o operador lê na
// tela e no export), mas tem um preço: renomear "Bebidas" para "Bebidas e
// água" deixaria todo modelo salvo filtrando por um nome que não existe mais.
//
// O estrago é SILENCIOSO — o relatório não dá erro, vem vazio. O operador
// conclui que não vendeu nada no mês.
//
// Avisar seria meia solução: o operador ainda teria de abrir cada modelo e
// corrigir à mão. Aqui a gente reescreve, e quem renomeou fica sabendo quantos
// modelos foram ajustados.
//
// Só o que casa EXATAMENTE com o nome antigo é tocado, e só dentro do campo
// pedido. Nada mais da configuração é reserializado às cegas: o que não casa
// volta a gravar igual ao que estava.
// ============================================================

/** Troca o valor em todos os modelos salvos. Devolve quantos foram ajustados. */
export async function renomearValorDeFiltro(
  campo: string,
  de: string,
  para: string,
): Promise<number> {
  if (!de || !para || de === para) return 0;

  const [presets, consultas] = await Promise.all([
    renomearEmReportPresets(campo, de, para),
    renomearEmSavedReports(campo, de, para),
  ]);
  return presets + consultas;
}

/**
 * Troca um valor escalar ou um item de lista; `null` = nada a mudar aqui.
 *
 * O `null` é o que mantém a reescrita cirúrgica: quem não casa não é regravado,
 * então nenhuma outra parte da configuração passa por serialização às cegas.
 */
export function trocarValor(valor: unknown, de: string, para: string): unknown | null {
  if (valor === de) return para;
  if (Array.isArray(valor) && valor.includes(de)) {
    return valor.map((v) => (v === de ? para : v));
  }
  return null;
}

/**
 * Tela "Configurar relatório": `config.filtros` é um mapa `{ [filtroId]: valor }`
 * (ver `reportConfigSchema`), e o filtro de categoria guarda o nome.
 *
 * Pura para dar teste: é aqui que mora a garantia de não estragar o resto da
 * configuração enquanto conserta um campo.
 */
export function trocarNaConfig(
  config: unknown,
  campo: string,
  de: string,
  para: string,
): Record<string, unknown> | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  const filtros = c.filtros;
  if (!filtros || typeof filtros !== "object" || Array.isArray(filtros)) return null;

  const mapa = filtros as Record<string, unknown>;
  const novo = trocarValor(mapa[campo], de, para);
  if (novo === null) return null;
  return { ...c, filtros: { ...mapa, [campo]: novo } };
}

/**
 * Análise salva (`/relatorios/consulta`): `consulta.filtros` é uma LISTA de
 * `{ campo, op, valor }` (ver `consultaSchema`), não um mapa. Mesmo bug, outra
 * forma — por isso as duas funções.
 */
export function trocarNaConsulta(
  consulta: unknown,
  campo: string,
  de: string,
  para: string,
): Record<string, unknown> | null {
  if (!consulta || typeof consulta !== "object") return null;
  const c = consulta as Record<string, unknown>;
  if (!Array.isArray(c.filtros)) return null;

  let mexeu = false;
  const novos = (c.filtros as { campo?: string; valor?: unknown }[]).map((f) => {
    if (f?.campo !== campo) return f;
    const novo = trocarValor(f.valor, de, para);
    if (novo === null) return f;
    mexeu = true;
    return { ...f, valor: novo };
  });
  return mexeu ? { ...c, filtros: novos } : null;
}

async function renomearEmReportPresets(campo: string, de: string, para: string) {
  const presets = await db.reportPreset.findMany({ select: { id: true, config: true } });
  let n = 0;
  for (const p of presets) {
    const novo = trocarNaConfig(p.config, campo, de, para);
    if (!novo) continue;
    await db.reportPreset.update({ where: { id: p.id }, data: { config: novo } });
    n += 1;
  }
  return n;
}

async function renomearEmSavedReports(campo: string, de: string, para: string) {
  const salvos = await db.savedReport.findMany({ select: { id: true, consulta: true } });
  let n = 0;
  for (const s of salvos) {
    const novo = trocarNaConsulta(s.consulta, campo, de, para);
    if (!novo) continue;
    await db.savedReport.update({ where: { id: s.id }, data: { consulta: novo } });
    n += 1;
  }
  return n;
}
