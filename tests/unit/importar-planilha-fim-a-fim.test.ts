import { describe, it, expect, vi } from "vitest";

// Catálogo falso: casa qualquer nome por R$ 5. O casamento fuzzy tem teste
// próprio (busca-produto-rank) — aqui o que importa é o pipeline em volta.
vi.mock("@/lib/vendas/casar-produto-venda", () => ({
  criarCasadorDeProdutos: async () => (nome: string) => ({
    id: `p-${nome}`,
    nome,
    precoVenda: 5,
  }),
}));

import { decodificarCsv } from "@/lib/vendas/importar-historico";
import { matrizDeCsv, montarImportacaoPlanilha } from "@/lib/vendas/importar-planilha-transacoes";

/**
 * Recorte fiel do export de um PDV de conveniência, com as três armadilhas que
 * o arquivo real trouxe: cabeçalho corrompido pelo encoding ("DescriÃ§Ã£o"),
 * data em MM/DD/YYYY e hora de 12 horas com AM/PM. Mais sangria de caixa,
 * linha em branco e rodapé de totais.
 */
const CSV = `No.Tran,Data,Hora,Tipo,DescriÃ§Ã£o,Cliente,Vl.Produtos,Desconto,Tx.Entrega/Frete,Total Final,Valor Pago,Meio Pagto,Cancelado
231162,08/24/2026,02:00:18 AM,Venda,"3 X Bala Fini 15g Azeda
1 X Refr Fanta 350ml Uva",,11,,0,11,11,Pix,NÃ£o
231157,08/24/2026,01:13:37 AM,Sangria de Caixa,,,-50,,,-50,,,NÃ£o
231156,08/24/2026,12:42:40 AM,Venda,1 X Salg Pingo de Ouro 76g,,7.5,,0,7.5,10,Dinheiro,NÃ£o
230908,08/23/2026,11:25:08 AM,Venda,"1 X Agua 1,5l S/Gas
2 X Cerv Schin 473ml",,35.25,,0,35.25,35.25,CartÃ£o de CrÃ©dito,NÃ£o
,,,,,,,,,,,,
,,,,,,53.75,0,,53.75,56.25,,`;

async function importar() {
  const bytes = new Uint8Array(Buffer.from(CSV, "utf8"));
  return montarImportacaoPlanilha(matrizDeCsv(decodificarCsv(bytes)), "imp:t1");
}

describe("importação fim a fim do export de transações", () => {
  it("importa só as vendas, sem pular nada", async () => {
    const r = await importar();
    expect(r.vendas.length).toBe(3);
    expect(r.vendasPuladas).toBe(0);
    expect(r.itensPulados).toBe(0);
    expect(r.naoVendas).toEqual([{ tipo: "Sangria de Caixa", vezes: 1 }]);
    expect(r.totalLiquido).toBeCloseTo(53.75, 2);
  });

  it("lê a data como MM/DD e a hora com AM/PM", async () => {
    const [primeira, , ultima] = (await importar()).vendas;
    expect(primeira.dataHora.getMonth()).toBe(7); // agosto, não o mês 24
    expect(primeira.dataHora.getDate()).toBe(24);
    expect(primeira.dataHora.getHours()).toBe(2);
    expect(ultima.dataHora.getDate()).toBe(23);
    expect(ultima.dataHora.getHours()).toBe(11);
  });

  it("trata 12:42 AM como madrugada, não meio-dia", async () => {
    const meiaNoite = (await importar()).vendas[1];
    expect(meiaNoite.dataHora.getHours()).toBe(0);
    expect(meiaNoite.dataHora.getMinutes()).toBe(42);
  });

  it("rateia o total entre os itens sem perder centavo", async () => {
    for (const v of (await importar()).vendas) {
      const soma = v.itens.reduce((s, i) => s + i.total, 0);
      expect(soma).toBeCloseTo(v.total, 2);
    }
  });

  it("reconstrói o pagamento e o troco do dinheiro", async () => {
    const [pix, dinheiro, cartao] = (await importar()).vendas;
    expect(pix.pagamentos).toEqual([{ metodo: "PIX", valor: 11, troco: null }]);
    expect(dinheiro.pagamentos).toEqual([{ metodo: "DINHEIRO", valor: 7.5, troco: 2.5 }]);
    expect(cartao.pagamentos).toEqual([
      { metodo: "CARTAO_CREDITO", valor: 35.25, troco: null },
    ]);
  });

  it("usa No.Tran como chave de idempotência", async () => {
    const chaves = (await importar()).vendas.map((v) => v.chaveExterna);
    expect(chaves).toEqual(["imp:t1:231162", "imp:t1:231156", "imp:t1:230908"]);
  });
});
