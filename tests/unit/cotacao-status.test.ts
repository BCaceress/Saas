import { describe, expect, it } from "vitest";
import { andamento, statusVisivel } from "@/app/(app)/cotacoes/_status";
import { hrefMobile } from "@/components/mobile/nav";

// O rótulo de andamento da cotação é DERIVADO da contagem de convites — não
// existe coluna para ele. Isso o torna a peça mais fácil de quebrar em silêncio
// (um filtro a mais na consulta e "Respondida" vira mentira), e a mais barata
// de testar.

describe("statusVisivel", () => {
  it("fora de ABERTA, o estado do banco manda", () => {
    expect(statusVisivel("RASCUNHO", 0, 0).label).toBe("Rascunho");
    expect(statusVisivel("DECIDIDA", 3, 3).label).toBe("Virou pedido");
    expect(statusVisivel("CANCELADA", 3, 0).label).toBe("Cancelada");
    // Encerrada com todo mundo respondendo continua encerrada: quem fechou a
    // cotação não quer vê-la anunciada como "Respondida".
    expect(statusVisivel("ENCERRADA", 2, 2).label).toBe("Encerrada");
  });

  it("aberta sem convidado é só 'Enviada'", () => {
    expect(statusVisivel("ABERTA", 0, 0).label).toBe("Enviada");
  });

  it("separa aguardando, parcial e respondida", () => {
    expect(statusVisivel("ABERTA", 3, 0).label).toBe("Aguardando respostas");
    expect(statusVisivel("ABERTA", 3, 1).label).toBe("Parcialmente respondida");
    expect(statusVisivel("ABERTA", 3, 3).label).toBe("Respondida");
  });

  it("recusa sai das duas contas: fecha a espera sem virar resposta", () => {
    // 2 responderam, 1 recusou, ninguém mais devendo → acabou.
    expect(statusVisivel("ABERTA", 3, 2, 1).label).toBe("Respondida");
    // Ainda falta um pendente.
    expect(statusVisivel("ABERTA", 4, 2, 1).label).toBe("Parcialmente respondida");
  });

  it("todo mundo recusou continua aguardando — ninguém cotou", () => {
    expect(statusVisivel("ABERTA", 2, 0, 2).label).toBe("Aguardando respostas");
  });

  it("andamento fala em gente, não em enum", () => {
    expect(andamento(0, 0)).toBe("nenhum fornecedor convidado");
    expect(andamento(1, 0)).toBe("1 fornecedor · nenhuma resposta");
    expect(andamento(3, 0)).toBe("3 fornecedores · nenhuma resposta");
    expect(andamento(4, 2)).toBe("2 de 4 responderam");
  });
});

// O alerta de cotação nasce no motor compartilhado com o desktop e leva
// `/cotacoes/<id>`. No celular ele precisa abrir A cotação, não a lista.
describe("hrefMobile para cotações", () => {
  it("mantém o id quando existe tela equivalente", () => {
    expect(hrefMobile("/cotacoes/clx0mn4k7000008l3f2h9abcd")).toBe(
      "/m/cotacoes/clx0mn4k7000008l3f2h9abcd",
    );
  });

  it("a lista continua caindo na lista", () => {
    expect(hrefMobile("/cotacoes")).toBe("/m/cotacoes");
  });

  it("sub-rota que só existe no desktop não vira 404 no mobile", () => {
    // `/cotacoes/respostas` (Central de Respostas) não tem versão `/m`.
    expect(hrefMobile("/cotacoes/respostas")).toBe("/m/cotacoes");
  });
});
