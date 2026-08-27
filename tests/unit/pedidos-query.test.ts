import { describe, it, expect } from "vitest";
import {
  filtrosDaUrl,
  urlDosFiltros,
  filtroDoBanco,
  filtrosAtivos,
  PO_FILTROS_VAZIO,
  PO_STATUS_ABERTOS,
  STATUS_ABERTOS,
} from "@/app/(app)/pedidos/_query";

// O recorte de /pedidos passou a viver na URL e a ser aplicado no banco. Estes
// testes travam a ida e a volta: se os dois lados divergirem, a tela mostra um
// recorte e o servidor devolve outro — e ninguém percebe, porque nada quebra.

describe("filtrosDaUrl", () => {
  it("sem parâmetros, abre no padrão da tela", () => {
    const f = filtrosDaUrl({});
    expect(f.status).toBe(PO_STATUS_ABERTOS);
    expect(f.periodo).toBe("30");
    expect(f.pagina).toBe(1);
  });

  // Quem chega com busca procura UM pedido, que pode muito bem estar
  // concluído. Manter o recorte "em aberto" esconderia o que a pessoa veio ver.
  it("busca na URL derruba os recortes padrão", () => {
    const f = filtrosDaUrl({ q: "PC-00042" });
    expect(f.q).toBe("PC-00042");
    expect(f.status).toBe("");
    expect(f.periodo).toBe("");
  });

  it("recorte explícito vence, mesmo com busca", () => {
    const f = filtrosDaUrl({ q: "heineken", status: "ENVIADO", periodo: "7" });
    expect(f.status).toBe("ENVIADO");
    expect(f.periodo).toBe("7");
  });

  it("ordem inválida cai no padrão em vez de quebrar", () => {
    expect(filtrosDaUrl({ ordem: "drop-table" }).ordem).toBe("recentes");
  });

  it("página inválida ou zero vira 1", () => {
    expect(filtrosDaUrl({ pagina: "0" }).pagina).toBe(1);
    expect(filtrosDaUrl({ pagina: "-3" }).pagina).toBe(1);
    expect(filtrosDaUrl({ pagina: "abc" }).pagina).toBe(1);
    expect(filtrosDaUrl({ pagina: "4" }).pagina).toBe(4);
  });

  it("aceita array de searchParams (?q=a&q=b) usando o primeiro", () => {
    expect(filtrosDaUrl({ q: ["primeiro", "segundo"] }).q).toBe("primeiro");
  });
});

describe("urlDosFiltros", () => {
  it("padrão não escreve nada — URL limpa é URL legível", () => {
    expect(urlDosFiltros(PO_FILTROS_VAZIO)).toBe("");
  });

  it("só o que difere do padrão entra", () => {
    const url = urlDosFiltros({ ...PO_FILTROS_VAZIO, supplierId: "abc", pagina: 3 });
    expect(url).toContain("fornecedor=abc");
    expect(url).toContain("pagina=3");
    expect(url).not.toContain("periodo=");
    expect(url).not.toContain("ordem=");
  });

  it("ida e volta preserva o recorte", () => {
    const original = {
      ...PO_FILTROS_VAZIO,
      q: "cerveja",
      supplierId: "forn-1",
      status: "AGUARDANDO",
      recebimento: "parcial" as const,
      periodo: "90",
      ordem: "valor-desc" as const,
      pagina: 2,
    };
    const url = urlDosFiltros(original);
    const sp = Object.fromEntries(new URLSearchParams(url.slice(1)));
    expect(filtrosDaUrl(sp)).toEqual(original);
  });
});

describe("filtrosAtivos", () => {
  it("o padrão não conta como filtro — senão 'Limpar' aparece sempre", () => {
    expect(filtrosAtivos(PO_FILTROS_VAZIO)).toBe(false);
  });

  it("ordenação não é filtro", () => {
    expect(filtrosAtivos({ ...PO_FILTROS_VAZIO, ordem: "numero" })).toBe(false);
  });

  it("busca, fornecedor, status ou período contam", () => {
    expect(filtrosAtivos({ ...PO_FILTROS_VAZIO, q: "x" })).toBe(true);
    expect(filtrosAtivos({ ...PO_FILTROS_VAZIO, supplierId: "x" })).toBe(true);
    expect(filtrosAtivos({ ...PO_FILTROS_VAZIO, status: "" })).toBe(true);
    expect(filtrosAtivos({ ...PO_FILTROS_VAZIO, recebimento: "sem" })).toBe(true);
    expect(filtrosAtivos({ ...PO_FILTROS_VAZIO, periodo: "" })).toBe(true);
  });
});

describe("filtroDoBanco", () => {
  const paginacao = { skip: 0, take: 25 };

  it('"Em aberto" vira a lista de status que ainda dão trabalho', () => {
    const f = filtroDoBanco(PO_FILTROS_VAZIO, paginacao);
    expect(f.status).toEqual(STATUS_ABERTOS);
    expect(f.status).not.toContain("RECEBIDO");
    expect(f.status).not.toContain("CANCELADO");
  });

  it('"Status: todos" não restringe status', () => {
    expect(filtroDoBanco({ ...PO_FILTROS_VAZIO, status: "" }, paginacao).status).toBeUndefined();
  });

  it("um status específico vira lista de um", () => {
    expect(filtroDoBanco({ ...PO_FILTROS_VAZIO, status: "ENVIADO" }, paginacao).status).toEqual([
      "ENVIADO",
    ]);
  });

  // EM_TRANSITO saiu do vocabulário do pedido mas continua no enum do banco.
  // Filtrar por "Confirmado" e esconder o legado faria a lista contradizer a
  // coluna Status, que desenha os dois com o mesmo badge.
  it("Confirmado arrasta o EM_TRANSITO legado junto", () => {
    const f = filtroDoBanco({ ...PO_FILTROS_VAZIO, status: "AGUARDANDO" }, paginacao);
    expect(f.status).toEqual(["AGUARDANDO", "EM_TRANSITO"]);
  });

  // Recebimento é condição SOBRE o pedido, não status dele: os dois recortes
  // convivem em vez de disputar o mesmo campo.
  it("recebimento viaja separado do status", () => {
    const f = filtroDoBanco({ ...PO_FILTROS_VAZIO, recebimento: "parcial" }, paginacao);
    expect(f.recebimento).toBe("parcial");
    expect(f.status).toEqual(STATUS_ABERTOS);
    expect(filtroDoBanco(PO_FILTROS_VAZIO, paginacao).recebimento).toBeNull();
  });

  it("período vazio significa todo período, não zero dias", () => {
    expect(filtroDoBanco({ ...PO_FILTROS_VAZIO, periodo: "" }, paginacao).periodoDias).toBeNull();
    expect(filtroDoBanco({ ...PO_FILTROS_VAZIO, periodo: "7" }, paginacao).periodoDias).toBe(7);
  });

  it("repassa a paginação recebida", () => {
    const f = filtroDoBanco(PO_FILTROS_VAZIO, { skip: 50, take: 25 });
    expect(f.skip).toBe(50);
    expect(f.take).toBe(25);
  });
});
