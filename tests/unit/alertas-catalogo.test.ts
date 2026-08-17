import { describe, expect, it } from "vitest";
import {
  CATALOGO,
  TODOS_ALERTAS,
  alertaDeEstoque,
  alertasDaEstrategia,
  categoriasComAlertas,
  kindDeAlerta,
  parseAlertasConfig,
  resolverAlertas,
  type AlertKind,
} from "@/lib/alertas/catalogo";
import { classificarNivel, policyDoTenant } from "@/lib/estoque-estrategia";
import { ALERT_ICON } from "@/components/app/alert-icons";

/**
 * Contrato dos alertas. O que se protege aqui é a promessa feita ao operador
 * em Configurações: a estratégia que ele escolhe manda no que o sino diz.
 * Um alerta de "abaixo do mínimo" numa empresa que controla por rotatividade
 * é uma cobrança por uma meta que ela desligou.
 */

const P = {
  MINIMO: policyDoTenant({ tipoControleEstoque: "MINIMO", diasCobertura: 7 }),
  MINIMO_IDEAL: policyDoTenant({ tipoControleEstoque: "MINIMO_IDEAL", diasCobertura: 7 }),
  ROTATIVIDADE: policyDoTenant({ tipoControleEstoque: "ROTATIVIDADE", diasCobertura: 7 }),
};

const kindsDe = (p: typeof P.MINIMO) => alertasDaEstrategia(p).map((d) => d.kind).sort();

const k = (p: typeof P.MINIMO, d: Parameters<typeof alertaDeEstoque>[1]) =>
  alertaDeEstoque(p, d)?.kind ?? null;

describe("catálogo × estratégia", () => {
  it("rotatividade não fala em mínimo nem em ideal", () => {
    const kinds = kindsDe(P.ROTATIVIDADE);
    expect(kinds).not.toContain("minimo");
    expect(kinds).not.toContain("reposicao");
    expect(kinds).toContain("cobertura-critica");
    expect(kinds).toContain("cobertura-baixa");
  });

  it("estratégias de meta fixa não falam em cobertura", () => {
    for (const p of [P.MINIMO, P.MINIMO_IDEAL]) {
      const kinds = kindsDe(p);
      expect(kinds).not.toContain("cobertura-critica");
      expect(kinds).not.toContain("cobertura-baixa");
      expect(kinds).toContain("minimo");
    }
  });

  it("só o mínimo + ideal tem o aviso de ideal", () => {
    expect(kindsDe(P.MINIMO_IDEAL)).toContain("reposicao");
    expect(kindsDe(P.MINIMO)).not.toContain("reposicao");
  });

  it("categoria sem alerta nenhum não vira interruptor na tela", () => {
    for (const p of Object.values(P)) {
      // "consumo" está declarado como categoria mas nada o produz hoje.
      expect(categoriasComAlertas(p)).not.toContain("consumo");
      for (const cat of categoriasComAlertas(p)) {
        expect(alertasDaEstrategia(p).some((d) => d.categoria === cat)).toBe(true);
      }
    }
  });

  it("todo alerta do catálogo tem ícone", () => {
    for (const def of TODOS_ALERTAS) {
      expect(ALERT_ICON[def.icone], def.kind).toBeTruthy();
      expect(def.kind).toBe(CATALOGO[def.kind].kind);
    }
  });

  it("o tipo sai do id da ocorrência, inclusive com produto e ponto", () => {
    expect(kindDeAlerta("minimo:prod_1:site_1")).toBe("minimo");
    expect(kindDeAlerta("validade-vencida:prod_1:site_1")).toBe("validade-vencida");
    expect(kindDeAlerta("alerta-que-nao-existe:1")).toBeNull();
  });
});

describe("alertaDeEstoque", () => {
  it("saldo negativo e zerado valem em toda estratégia", () => {
    for (const p of Object.values(P)) {
      expect(k(p, { estoque: -2, minimo: 10 })).toBe("estoque-negativo");
      expect(k(p, { estoque: 0, minimo: 10 })).toBe("sem-estoque");
    }
  });

  it("MINIMO alerta no piso e ignora o ideal", () => {
    expect(k(P.MINIMO, { estoque: 10, minimo: 10 })).toBe("minimo");
    expect(k(P.MINIMO, { estoque: 3, minimo: 10 })).toBe("minimo");
    expect(k(P.MINIMO, { estoque: 20, minimo: 10, ideal: 50 })).toBeNull();
  });

  it("MINIMO_IDEAL separa piso de alvo", () => {
    expect(k(P.MINIMO_IDEAL, { estoque: 10, minimo: 10, ideal: 50 })).toBe("minimo");
    expect(k(P.MINIMO_IDEAL, { estoque: 20, minimo: 10, ideal: 50 })).toBe("reposicao");
    expect(k(P.MINIMO_IDEAL, { estoque: 60, minimo: 10, ideal: 50 })).toBeNull();
  });

  it("meta fixa nunca notifica por giro", () => {
    // Saldo alto, sem metas, vendendo muito: é assunto da sugestão de compra,
    // não do sino de quem escolheu governar por metas.
    expect(k(P.MINIMO, { estoque: 100, minimo: 0, mediaDia: 50 })).toBeNull();
    expect(k(P.MINIMO_IDEAL, { estoque: 100, minimo: 0, ideal: 0, mediaDia: 50 })).toBeNull();
  });

  it("ROTATIVIDADE decide por cobertura e ignora o mínimo gravado", () => {
    expect(k(P.ROTATIVIDADE, { estoque: 2, minimo: 999, mediaDia: 2 })).toBe("cobertura-critica");
    expect(k(P.ROTATIVIDADE, { estoque: 10, minimo: 999, mediaDia: 2 })).toBe("cobertura-baixa");
    expect(k(P.ROTATIVIDADE, { estoque: 100, minimo: 999, mediaDia: 2 })).toBeNull();
    // Sem giro na janela não há o que projetar.
    expect(k(P.ROTATIVIDADE, { estoque: 1, minimo: 999, mediaDia: 0 })).toBeNull();
  });

  it("o corte de crítico segue a empresa, não uma constante", () => {
    const frouxo = policyDoTenant({
      tipoControleEstoque: "ROTATIVIDADE",
      diasCobertura: 10,
      coberturaCriticaPct: 20,
    });
    const rigido = policyDoTenant({
      tipoControleEstoque: "ROTATIVIDADE",
      diasCobertura: 10,
      coberturaCriticaPct: 50,
    });
    // 3 dias de cobertura: crítico para quem corta em 50%, só baixo para 20%.
    expect(k(frouxo, { estoque: 3, mediaDia: 1 })).toBe("cobertura-baixa");
    expect(k(rigido, { estoque: 3, mediaDia: 1 })).toBe("cobertura-critica");
  });

  it("texto fala a língua da estratégia", () => {
    expect(alertaDeEstoque(P.MINIMO, { estoque: 3, minimo: 10 })?.descricao).toContain("mínimo");
    expect(alertaDeEstoque(P.ROTATIVIDADE, { estoque: 2, mediaDia: 2 })?.descricao).toContain(
      "Cobertura",
    );
  });

  it("sem base para julgar, só saldo negativo ou zerado", () => {
    const semMetas = { estoque: 5, minimo: 0, ideal: 0, mediaDia: 0 };
    expect(classificarNivel(P.MINIMO_IDEAL, semMetas).semBase).toBe(true);
    expect(k(P.MINIMO_IDEAL, semMetas)).toBeNull();
    expect(k(P.MINIMO_IDEAL, { ...semMetas, estoque: 0 })).toBe("sem-estoque");
  });
});

describe("preferência por tipo", () => {
  const vazio = { alertasDesativados: [], alertasConfig: null };

  it("padrão do catálogo quando não há preferência", () => {
    const r = resolverAlertas(vazio, P.MINIMO_IDEAL);
    expect(r.minimo).toEqual({ ligado: true, prioridade: "alto" });
  });

  it("estratégia manda mais que a preferência", () => {
    const r = resolverAlertas(
      { ...vazio, alertasConfig: { reposicao: { ligado: true } } },
      P.ROTATIVIDADE,
    );
    expect(r.reposicao.ligado).toBe(false);
  });

  it("escolha por tipo vence a categoria desligada no formato antigo", () => {
    const r = resolverAlertas(
      { alertasDesativados: ["criticos"], alertasConfig: { "sem-preco": { ligado: true } } },
      P.MINIMO_IDEAL,
    );
    expect(r["sem-preco"].ligado).toBe(true);
    // Sem escolha explícita, o desligamento antigo continua valendo.
    expect(r["sem-estoque"].ligado).toBe(false);
  });

  it("prioridade da empresa substitui a do catálogo", () => {
    const r = resolverAlertas(
      { ...vazio, alertasConfig: { parado: { ligado: true, prioridade: "alto" } } },
      P.MINIMO,
    );
    expect(r.parado.prioridade).toBe("alto");
    expect(CATALOGO.parado.prioridade).toBe("baixo");
  });

  it("JSON estragado não derruba o sino", () => {
    expect(parseAlertasConfig(null)).toEqual({});
    expect(parseAlertasConfig("texto")).toEqual({});
    expect(parseAlertasConfig([1, 2])).toEqual({});
    expect(parseAlertasConfig({ inexistente: { ligado: false } })).toEqual({});
    expect(parseAlertasConfig({ parado: { ligado: "sim", prioridade: "urgente" } })).toEqual({
      parado: {},
    });
    // Com lixo dentro, o alerta volta ao padrão em vez de sumir.
    const r = resolverAlertas(
      { alertasDesativados: [], alertasConfig: { parado: { ligado: "sim" } } },
      P.MINIMO,
    );
    expect(r.parado).toEqual({ ligado: true, prioridade: "baixo" });
  });

  it("resolve todo tipo do catálogo, sem buraco", () => {
    const r = resolverAlertas(vazio, P.ROTATIVIDADE);
    for (const kind of Object.keys(CATALOGO) as AlertKind[]) {
      expect(r[kind], kind).toBeDefined();
    }
  });
});
