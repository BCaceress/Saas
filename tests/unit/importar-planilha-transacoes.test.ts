import { describe, it, expect } from "vitest";
import { gerarXlsx } from "@/lib/relatorios/xlsx";
import { lerXlsx } from "@/lib/compras/connectors/planilha";
import {
  detectarOrdemData,
  matrizDeCsv,
  moeda,
  montarDataHora,
  pareceExportDeTransacoes,
  ratear,
  separarItens,
} from "@/lib/vendas/importar-planilha-transacoes";

describe("moeda", () => {
  it("lê o formato pt-BR do export", () => {
    expect(moeda("R$ 11,00")).toBe(11);
    expect(moeda("R$ 1.234,56")).toBe(1234.56);
    expect(moeda("-R$ 50,00")).toBe(-50);
  });

  it("lê decimal com ponto e vazio", () => {
    expect(moeda("1234.56")).toBe(1234.56);
    expect(moeda("31.25")).toBe(31.25);
    expect(moeda("")).toBe(0);
    expect(moeda(undefined)).toBe(0);
  });
});

describe("separarItens", () => {
  it("quebra a coluna Descrição em itens", () => {
    const itens = separarItens("3 X Bala Fini 15g Azeda\n1 X Refr Fanta 350ml Uva");
    expect(itens).toEqual([
      { quantidade: 3, nome: "Bala Fini 15g Azeda" },
      { quantidade: 1, nome: "Refr Fanta 350ml Uva" },
    ]);
  });

  it("junta a continuação do nome quebrada em outra linha", () => {
    const itens = separarItens("1 X Vinho San Martin\n1,4l Tinto Suave\n1 X Cig Camel Blue");
    expect(itens).toEqual([
      { quantidade: 1, nome: "Vinho San Martin 1,4l Tinto Suave" },
      { quantidade: 1, nome: "Cig Camel Blue" },
    ]);
  });

  it("separa itens grudados numa linha só", () => {
    expect(separarItens("2 X Bisc Trakinas 126g 1 X Salg Doritos 120g")).toEqual([
      { quantidade: 2, nome: "Bisc Trakinas 126g" },
      { quantidade: 1, nome: "Salg Doritos 120g" },
    ]);
  });

  it("devolve vazio para descrição sem item", () => {
    expect(separarItens("")).toEqual([]);
    expect(separarItens("Sangria de Caixa")).toEqual([]);
  });
});

describe("ratear", () => {
  it("distribui pelo peso e fecha exatamente na base", () => {
    const r = ratear(46, [10, 20, 16]);
    expect(r.reduce((s, v) => s + v, 0)).toBeCloseTo(46, 10);
    expect(r[0]).toBeCloseTo(10, 2);
  });

  it("não perde centavo em divisão inexata", () => {
    const r = ratear(10, [1, 1, 1]);
    expect(r.reduce((s, v) => s + v, 0)).toBeCloseTo(10, 10);
  });

  it("divide igual quando nenhum item tem preço", () => {
    expect(ratear(10, [0, 0])).toEqual([5, 5]);
  });

  it("aceita lista vazia", () => {
    expect(ratear(10, [])).toEqual([]);
  });
});

describe("leitura do .xlsx de transações", () => {
  const CABECALHO = [
    "No.Tran",
    "Data",
    "Hora",
    "Tipo",
    "Descrição",
    "Cliente",
    "Vl.Produtos",
    "Desconto",
    "Tx.Entrega/Frete",
    "Total Final",
    "Valor Pago",
    "Meio Pagto",
    "Cancelado",
  ];

  it("preserva a quebra de linha dentro da Descrição", () => {
    const bytes = gerarXlsx({
      aba: "Vendas",
      cabecalho: CABECALHO,
      linhas: [
        [
          231162,
          "24/08/2026",
          "02:00",
          "Venda",
          "3 X Bala Fini 15g Azeda\n1 X Refr Fanta 350ml Uva",
          "",
          "R$ 11,00",
          "R$ 0,00",
          "R$ 0,00",
          "R$ 11,00",
          "R$ 11,00",
          "Pix",
          "Não",
        ],
        [
          231157,
          "24/08/2026",
          "01:13",
          "Sangria de Caixa",
          "",
          "",
          "-R$ 50,00",
          "",
          "",
          "-R$ 50,00",
          "",
          "",
          "Não",
        ],
      ],
    });

    const matriz = lerXlsx(bytes);
    expect(matriz[0]).toEqual(CABECALHO);
    expect(pareceExportDeTransacoes(matriz)).toBe(true);
    expect(separarItens(matriz[1][4])).toEqual([
      { quantidade: 3, nome: "Bala Fini 15g Azeda" },
      { quantidade: 1, nome: "Refr Fanta 350ml Uva" },
    ]);
    expect(moeda(matriz[1][9])).toBe(11);
    expect(matriz[2][3]).toBe("Sangria de Caixa");
  });
});

describe("montarDataHora", () => {
  it("lê data e hora em texto", () => {
    const d = montarDataHora("24/08/2026", "02:00")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(2);
    expect(d.getMinutes()).toBe(0);
  });

  it("lê o serial do Excel (data numérica + hora fracionária)", () => {
    // 2026-08-24 = 46258 dias desde 1899-12-30; 01:45 = 0,0729166…
    const d = montarDataHora("46258", "0.0729166666666667")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(1);
    expect(d.getMinutes()).toBe(45);
  });

  it("devolve null sem data", () => {
    expect(montarDataHora("", "02:00")).toBeNull();
    expect(montarDataHora("não é data", "")).toBeNull();
  });

  it("respeita a ordem mdy do arquivo", () => {
    const d = montarDataHora("08/24/2026", "02:00:18 AM", "mdy")!;
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(2);
  });

  it("converte o relógio de 12 horas", () => {
    expect(montarDataHora("08/24/2026", "12:42:47 AM", "mdy")!.getHours()).toBe(0);
    expect(montarDataHora("08/24/2026", "12:05:10 PM", "mdy")!.getHours()).toBe(12);
    expect(montarDataHora("08/24/2026", "01:45:08 PM", "mdy")!.getHours()).toBe(13);
    expect(montarDataHora("08/24/2026", "11:56:19 AM", "mdy")!.getHours()).toBe(11);
  });
});

describe("detectarOrdemData", () => {
  it("acha mdy quando o segundo número passa de 12", () => {
    expect(detectarOrdemData(["08/23/2026", "08/24/2026"])).toBe("mdy");
  });

  it("acha dmy quando o primeiro número passa de 12", () => {
    expect(detectarOrdemData(["23/08/2026", "24/08/2026"])).toBe("dmy");
  });

  it("cai em dmy quando o arquivo é todo ambíguo", () => {
    expect(detectarOrdemData(["01/02/2026", "03/04/2026"])).toBe("dmy");
  });

  it("ignora a data ISO e vazios", () => {
    expect(detectarOrdemData(["", "2026-08-24", "08/24/2026"])).toBe("mdy");
  });
});

describe("CSV com o layout de transações", () => {
  const CABECALHO =
    "No.Tran,Data,Hora,Tipo,Descrição,Cliente,Vl.Produtos,Desconto,Tx.Entrega/Frete,Total Final,Valor Pago,Meio Pagto";

  const CSV = [
    CABECALHO,
    '231162,08/24/2026,02:00:18 AM,Venda,"3 X Bala Fini 15g Azeda\n1 X Refr Fanta 350ml Uva",,11,,0,11,11,Pix',
    "231157,08/24/2026,01:13:37 AM,Sangria de Caixa,,,-50,,,-50,,",
  ].join("\n");

  it("é reconhecido como export de transações, não como CSV item a item", () => {
    expect(pareceExportDeTransacoes(matrizDeCsv(CSV))).toBe(true);
  });

  it("continua reconhecido com o cabeçalho corrompido pelo encoding", () => {
    const corrompido = CSV.replace("Descrição", "DescriÃ§Ã£o");
    expect(pareceExportDeTransacoes(matrizDeCsv(corrompido))).toBe(true);
  });

  it("não confunde o CSV item a item com export de transações", () => {
    const itemAItem = "venda_id,data_hora,produto,quantidade,preco_unitario\n1,2026-08-24 02:00,Bala,3,2";
    expect(pareceExportDeTransacoes(matrizDeCsv(itemAItem))).toBe(false);
  });

  it("mantém a quebra de linha da Descrição entre aspas", () => {
    const matriz = matrizDeCsv(CSV);
    expect(separarItens(matriz[1][4])).toEqual([
      { quantidade: 3, nome: "Bala Fini 15g Azeda" },
      { quantidade: 1, nome: "Refr Fanta 350ml Uva" },
    ]);
    expect(detectarOrdemData(matriz.slice(1).map((l) => l[1]))).toBe("mdy");
  });
});
