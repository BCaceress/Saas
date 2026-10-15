import { describe, it, expect } from "vitest";
import {
  filtrosAtivos,
  filtrosDaUrl,
  marcasCanonicas,
  montarPagina,
  mostraPedidos,
  periodoAplicavel,
  placeholderBusca,
  quantosFiltros,
  REC_FILTROS_VAZIO,
  REC_LIMITE_PADRAO,
  REC_STATUS,
  soPedidos,
  urlDosFiltros,
} from "@/app/(app)/recebimento/_query";

// /recebimento abre em TODOS. O status é UMA escolha e as marcas restringem por
// cima — tudo na URL, que é o que decide o que o servidor consulta. Estes testes
// travam esse contrato: se os dois lados divergirem, a tela mostra um recorte e
// o banco devolve outro, e nada quebra alto o bastante para alguém notar.

const base = REC_FILTROS_VAZIO;

describe("filtrosDaUrl", () => {
  it("sem parâmetros, mostra todos", () => {
    const f = filtrosDaUrl({});
    expect(f.status).toBe("");
    expect(f.marcas).toEqual([]);
    expect(f.pagina).toBe(1);
    expect(f.limite).toBe(REC_LIMITE_PADRAO);
  });

  it("lê status e marcas", () => {
    const f = filtrosDaUrl({ status: "aberto", marca: "sem-nfe,divergencia" });
    expect(f.status).toBe("aberto");
    // Ordem canônica: a mesma seleção gera a mesma URL.
    expect(f.marcas).toEqual(["divergencia", "sem-nfe"]);
  });

  // Links antigos (o alerta de /pedidos, favoritos do operador) vinham da
  // seleção múltipla e precisam cair no par status + marca equivalente.
  it("traduz os recortes legados", () => {
    expect(filtrosDaUrl({ status: "sem-nfe" })).toMatchObject({ status: "", marcas: ["sem-nfe"] });
    expect(filtrosDaUrl({ status: "andamento" })).toMatchObject({ status: "aberto", marcas: [] });
    // "Avulsos" não tem mais recorte: o link cai na visão geral, não num vazio.
    expect(filtrosDaUrl({ status: "avulsos" })).toMatchObject({ status: "", marcas: [] });
    expect(filtrosDaUrl({ status: "divergencia,concluidos" })).toMatchObject({
      status: "concluidos",
      marcas: ["divergencia"],
    });
  });

  it("valor desconhecido é ignorado — cai em todos", () => {
    expect(filtrosDaUrl({ status: "tudo" }).status).toBe("");
    expect(filtrosDaUrl({ marca: "qualquer" }).marcas).toEqual([]);
  });

  // Pedido aguardando não tem divergência nem NF-e: a combinação não existe.
  it("Aguardando descarta as marcas", () => {
    expect(filtrosDaUrl({ status: "aguardando", marca: "divergencia" }).marcas).toEqual([]);
    expect(urlDosFiltros({ ...base, status: "aguardando", marcas: ["sem-nfe"] })).toBe(
      "?status=aguardando",
    );
  });

  // Quem chega buscando procura UM registro, que pode ser de meses atrás.
  it("busca na URL derruba o período padrão", () => {
    expect(filtrosDaUrl({ q: "REC-00054" }).periodo).toBe("");
  });

  it("ordem da chegada: mais recente primeiro, salvo pedido explícito", () => {
    expect(filtrosDaUrl({}).ordem).toBe("desc");
    expect(filtrosDaUrl({ ordem: "asc" }).ordem).toBe("asc");
    expect(filtrosDaUrl({ ordem: "qualquer" }).ordem).toBe("desc");
    expect(urlDosFiltros({ ...base, ordem: "asc" })).toBe("?ordem=asc");
  });

  it("só aceita os tamanhos de página oferecidos", () => {
    expect(filtrosDaUrl({ limite: "50" }).limite).toBe(50);
    expect(filtrosDaUrl({ limite: "5000" }).limite).toBe(REC_LIMITE_PADRAO);
  });
});

describe("urlDosFiltros", () => {
  it("o padrão da tela não suja a URL", () => {
    expect(urlDosFiltros(base)).toBe("");
  });

  it("ida e volta preservam o recorte", () => {
    const f = {
      ...base,
      status: "concluidos" as const,
      marcas: ["sem-nfe" as const, "divergencia" as const],
      q: "AMBEV",
      pagina: 3,
      limite: 50,
    };
    const sp = Object.fromEntries(new URLSearchParams(urlDosFiltros(f).slice(1)));
    const volta = filtrosDaUrl(sp);
    expect(volta.status).toBe("concluidos");
    expect(volta.marcas).toEqual(["divergencia", "sem-nfe"]);
    expect(volta.q).toBe("AMBEV");
    expect(volta.pagina).toBe(3);
    expect(volta.limite).toBe(50);
  });
});

describe("status e marcas", () => {
  it("status na ordem do caminho da mercadoria", () => {
    expect(REC_STATUS.map((s) => s.value)).toEqual(["", "aguardando", "aberto", "concluidos"]);
  });

  it("marcas canônicas, sem repetição nem desconhecidas", () => {
    expect(marcasCanonicas(["sem-nfe", "x", "divergencia", "sem-nfe"])).toEqual([
      "divergencia",
      "sem-nfe",
    ]);
  });

  it("pedidos sobem no topo só na visão geral sem marcas", () => {
    expect(mostraPedidos({ status: "", marcas: [] })).toBe(true);
    expect(mostraPedidos({ status: "aguardando", marcas: [] })).toBe(true);
    expect(mostraPedidos({ status: "", marcas: ["divergencia"] })).toBe(false);
    expect(mostraPedidos({ status: "aberto", marcas: [] })).toBe(false);
  });

  it("só Aguardando troca a lista paginada para pedidos", () => {
    expect(soPedidos({ status: "aguardando" })).toBe(true);
    expect(soPedidos({ status: "" })).toBe(false);
  });

  // Esconder uma conferência aberta há 40 dias por causa de um filtro padrão de
  // 30 dias transformaria o filtro num apagador de pendência.
  it("período só vale onde há histórico — e nunca com Sem NF-e", () => {
    expect(periodoAplicavel({ status: "", marcas: [] })).toBe(true);
    expect(periodoAplicavel({ status: "concluidos", marcas: ["divergencia"] })).toBe(true);
    expect(periodoAplicavel({ status: "aberto", marcas: [] })).toBe(false);
    expect(periodoAplicavel({ status: "aguardando", marcas: [] })).toBe(false);
    expect(periodoAplicavel({ status: "", marcas: ["sem-nfe"] })).toBe(false);
  });

  it("filtro ativo e contagem do botão Filtros", () => {
    expect(filtrosAtivos(base)).toBe(false);
    expect(filtrosAtivos({ ...base, status: "concluidos" })).toBe(true);
    expect(filtrosAtivos({ ...base, marcas: ["divergencia"] })).toBe(true);
    expect(filtrosAtivos({ ...base, q: "REC-1" })).toBe(true);
    expect(filtrosAtivos({ ...base, periodo: "7" })).toBe(true);
    // Busca tem campo à vista e marcas vêm dos indicadores — não contam no botão.
    expect(quantosFiltros({ ...base, q: "x" })).toBe(0);
    expect(
      quantosFiltros({ ...base, status: "concluidos", marcas: ["divergencia"], supplierId: "s1" }),
    ).toBe(2);
  });

  it("a busca promete só o que a tela tem", () => {
    expect(placeholderBusca({ status: "aguardando" })).toContain("pedido");
    expect(placeholderBusca({ status: "aguardando" })).not.toContain("NF-e");
    expect(placeholderBusca({ status: "" })).toContain("NF-e");
    expect(placeholderBusca({ status: "" })).toContain("produto");
  });
});

describe("montarPagina", () => {
  it("conta as páginas pelo total do banco, não pelo que veio", () => {
    const p = montarPagina([1, 2, 3], 3482, { ...base, pagina: 2, limite: 20 });
    expect(p.total).toBe(3482);
    expect(p.page).toBe(2);
    expect(p.limit).toBe(20);
    expect(p.totalPages).toBe(175);
  });

  it("lista vazia ainda tem uma página — não zero", () => {
    expect(montarPagina([], 0, base).totalPages).toBe(1);
  });
});
