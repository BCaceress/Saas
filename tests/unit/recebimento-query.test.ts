import { describe, it, expect } from "vitest";
import {
  ABA_PADRAO,
  abaDePedidos,
  filtrosAtivos,
  filtrosDaUrl,
  montarPagina,
  periodoAplicavel,
  placeholderBusca,
  REC_FILTROS_VAZIO,
  REC_LIMITE_PADRAO,
  REC_TABS,
  urlDosFiltros,
} from "@/app/(app)/recebimento/_query";

// /recebimento mostra UMA ABA POR VEZ, e a aba mora na URL — é ela que decide
// qual consulta o servidor roda. Estes testes travam esse contrato: se os dois
// lados divergirem, a tela mostra um recorte e o banco devolve outro, e nada
// quebra alto o bastante para alguém notar.

describe("filtrosDaUrl", () => {
  it("sem parâmetros, abre em Aguardando — nunca no histórico", () => {
    const f = filtrosDaUrl({});
    expect(f.aba).toBe("aguardando");
    expect(f.aba).toBe(ABA_PADRAO);
    expect(f.pagina).toBe(1);
    expect(f.limite).toBe(REC_LIMITE_PADRAO);
  });

  // O parâmetro continua chamando `status` na URL de propósito: links antigos
  // (o alerta de /pedidos, favoritos do operador) precisam cair no lugar certo.
  it("aceita o recorte legado ?status=sem-nfe", () => {
    expect(filtrosDaUrl({ status: "sem-nfe" }).aba).toBe("sem-nfe");
  });

  it("recorte desconhecido cai na aba padrão, não numa lista vazia", () => {
    expect(filtrosDaUrl({ status: "tudo" }).aba).toBe(ABA_PADRAO);
    expect(filtrosDaUrl({ status: "" }).aba).toBe(ABA_PADRAO);
  });

  // Quem chega buscando procura UM registro, que pode ser de meses atrás.
  it("busca na URL derruba o período padrão", () => {
    expect(filtrosDaUrl({ q: "REC-00054" }).periodo).toBe("");
  });

  it("só aceita os tamanhos de página oferecidos", () => {
    expect(filtrosDaUrl({ limite: "50" }).limite).toBe(50);
    expect(filtrosDaUrl({ limite: "100" }).limite).toBe(100);
    expect(filtrosDaUrl({ limite: "5000" }).limite).toBe(REC_LIMITE_PADRAO);
  });
});

describe("urlDosFiltros", () => {
  it("o padrão da tela não suja a URL", () => {
    expect(urlDosFiltros(REC_FILTROS_VAZIO)).toBe("");
  });

  it("ida e volta preservam o recorte", () => {
    const f = { ...REC_FILTROS_VAZIO, aba: "concluidos" as const, q: "AMBEV", pagina: 3, limite: 50 };
    const url = urlDosFiltros(f);
    const sp = Object.fromEntries(new URLSearchParams(url.slice(1)));
    const volta = filtrosDaUrl(sp);
    expect(volta.aba).toBe("concluidos");
    expect(volta.q).toBe("AMBEV");
    expect(volta.pagina).toBe(3);
    expect(volta.limite).toBe(50);
  });
});

describe("as abas", () => {
  it("não existe aba 'Tudo' — cada aba é uma consulta só", () => {
    expect(REC_TABS.map((t) => t.aba)).toEqual([
      "aguardando",
      "andamento",
      "divergencia",
      "concluidos",
      "avulsos",
    ]);
  });

  it("só Aguardando mostra pedidos; o resto mostra recebimentos", () => {
    expect(abaDePedidos("aguardando")).toBe(true);
    expect(abaDePedidos("andamento")).toBe(false);
    expect(abaDePedidos("concluidos")).toBe(false);
  });

  // Esconder uma conferência aberta há 40 dias por causa de um filtro padrão de
  // 30 dias transformaria o filtro num apagador de pendência.
  it("período recorta histórico, não trabalho", () => {
    expect(periodoAplicavel("concluidos")).toBe(true);
    expect(periodoAplicavel("avulsos")).toBe(true);
    expect(periodoAplicavel("aguardando")).toBe(false);
    expect(periodoAplicavel("andamento")).toBe(false);
    expect(periodoAplicavel("divergencia")).toBe(false);
    expect(periodoAplicavel("sem-nfe")).toBe(false);
  });

  it("a aba não conta como filtro ativo — ela é onde a pessoa está", () => {
    expect(filtrosAtivos({ ...REC_FILTROS_VAZIO, aba: "concluidos" })).toBe(false);
    expect(filtrosAtivos({ ...REC_FILTROS_VAZIO, q: "REC-1" })).toBe(true);
    // Período fora da aba onde ele vale não recorta nada, então não conta.
    expect(filtrosAtivos({ ...REC_FILTROS_VAZIO, aba: "andamento", periodo: "7" })).toBe(false);
    expect(filtrosAtivos({ ...REC_FILTROS_VAZIO, aba: "concluidos", periodo: "7" })).toBe(true);
  });

  it("a busca promete só o que a aba tem", () => {
    expect(placeholderBusca("aguardando")).toContain("pedido");
    expect(placeholderBusca("aguardando")).not.toContain("NF-e");
    expect(placeholderBusca("concluidos")).toContain("NF-e");
  });
});

describe("montarPagina", () => {
  it("conta as páginas pelo total do banco, não pelo que veio", () => {
    const p = montarPagina([1, 2, 3], 3482, { ...REC_FILTROS_VAZIO, pagina: 2, limite: 20 });
    expect(p.total).toBe(3482);
    expect(p.page).toBe(2);
    expect(p.limit).toBe(20);
    expect(p.totalPages).toBe(175);
  });

  it("lista vazia ainda tem uma página — não zero", () => {
    const p = montarPagina([], 0, REC_FILTROS_VAZIO);
    expect(p.totalPages).toBe(1);
  });
});
