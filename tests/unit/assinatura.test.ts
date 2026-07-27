import { describe, it, expect } from "vitest";
import {
  descricaoCobranca,
  estadoAcesso,
  precoMensal,
  statusDoTenant,
  TOLERANCIA_DIAS,
} from "@/lib/assinatura";
import { ADDONS, PLANOS } from "@/lib/planos";

// O que se cobra e quem continua entrando. Errar aqui é cobrar o valor errado
// ou trancar a loja de quem está em dia — os dois destroem a conta do cliente.

const dias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

describe("precoMensal", () => {
  it("plano sem add-on custa o preço de tabela", () => {
    expect(precoMensal({ plano: "PRATA", addons: [], lojasExtras: 0 })).toBe(PLANOS.PRATA.preco);
    expect(precoMensal({ plano: "OURO", addons: [], lojasExtras: 0 })).toBe(PLANOS.OURO.preco);
  });

  it("soma add-on de valor fixo", () => {
    expect(precoMensal({ plano: "OURO", addons: ["fiscal"], lojasExtras: 0 })).toBe(
      PLANOS.OURO.preco + ADDONS.fiscal.preco,
    );
  });

  it("cobra o totem por dispositivo", () => {
    const tres = precoMensal({
      plano: "OURO",
      addons: ["autoatendimento"],
      lojasExtras: 0,
      totens: 3,
    });
    expect(tres).toBe(PLANOS.OURO.preco + ADDONS.autoatendimento.preco * 3);
  });

  it("sem totem cadastrado, cobra uma unidade — nunca zero", () => {
    const semTotem = precoMensal({ plano: "OURO", addons: ["autoatendimento"], lojasExtras: 0 });
    expect(semTotem).toBe(PLANOS.OURO.preco + ADDONS.autoatendimento.preco);
  });

  it("cobra loja extra pela quantidade, não por aparecer na lista", () => {
    const comLista = precoMensal({ plano: "OURO", addons: ["loja-extra"], lojasExtras: 2 });
    const semLista = precoMensal({ plano: "OURO", addons: [], lojasExtras: 2 });
    // A entrada "loja-extra" só marca a contratação; quem soma é lojasExtras.
    expect(comLista).toBe(semLista);
    expect(comLista).toBe(PLANOS.OURO.preco + ADDONS["loja-extra"].preco * 2);
  });

  it("ignora slug desconhecido em vez de quebrar a cobrança", () => {
    expect(precoMensal({ plano: "PRATA", addons: ["inventado"], lojasExtras: 0 })).toBe(
      PLANOS.PRATA.preco,
    );
  });
});

describe("descricaoCobranca", () => {
  it("descreve o que está sendo cobrado", () => {
    expect(descricaoCobranca({ plano: "OURO", addons: ["fiscal"], lojasExtras: 1 })).toBe(
      "NoHub Market Ouro + fiscal, 1 loja(s) extra",
    );
  });
});

describe("statusDoTenant", () => {
  it("assinatura ativa libera o acesso", () => {
    expect(statusDoTenant("ATIVA", { trialEndsAt: null, inadimplenteDesde: null })).toBe("ACTIVE");
  });

  it("inadimplente dentro da tolerância continua operando", () => {
    const ontem = dias(-1);
    expect(statusDoTenant("INADIMPLENTE", { trialEndsAt: null, inadimplenteDesde: ontem })).toBe(
      "ACTIVE",
    );
  });

  it("inadimplente além da tolerância é suspenso", () => {
    const velho = dias(-(TOLERANCIA_DIAS + 1));
    expect(statusDoTenant("INADIMPLENTE", { trialEndsAt: null, inadimplenteDesde: velho })).toBe(
      "SUSPENDED",
    );
  });

  it("pendente vale enquanto o teste durar", () => {
    expect(statusDoTenant("PENDENTE", { trialEndsAt: dias(3), inadimplenteDesde: null })).toBe(
      "TRIAL",
    );
    expect(statusDoTenant("PENDENTE", { trialEndsAt: dias(-1), inadimplenteDesde: null })).toBe(
      "SUSPENDED",
    );
    // Sem teste nenhum e sem pagamento não há por que liberar.
    expect(statusDoTenant("PENDENTE", { trialEndsAt: null, inadimplenteDesde: null })).toBe(
      "SUSPENDED",
    );
  });

  it("cancelada suspende", () => {
    expect(statusDoTenant("CANCELADA", { trialEndsAt: dias(10), inadimplenteDesde: null })).toBe(
      "SUSPENDED",
    );
  });
});

describe("estadoAcesso", () => {
  it("conta em dia não mostra faixa nenhuma", () => {
    const e = estadoAcesso({ status: "ACTIVE", trialEndsAt: null, plano: "OURO" });
    expect(e.podeEscrever).toBe(true);
    expect(e.aviso).toBeNull();
  });

  it("suspenso vira somente leitura, não perda de acesso", () => {
    const e = estadoAcesso({ status: "SUSPENDED", trialEndsAt: null, plano: "OURO" });
    expect(e.podeEscrever).toBe(false);
    expect(e.aviso?.tom).toBe("bloqueio");
  });

  it("teste com folga não incomoda; teste no fim avisa", () => {
    expect(estadoAcesso({ status: "TRIAL", trialEndsAt: dias(10), plano: "OURO" }).aviso).toBeNull();

    const perto = estadoAcesso({ status: "TRIAL", trialEndsAt: dias(2), plano: "OURO" });
    expect(perto.podeEscrever).toBe(true);
    expect(perto.aviso?.tom).toBe("alerta");
    expect(perto.diasTrial).toBe(2);
  });

  it("último dia de teste ainda permite operar", () => {
    const hoje = estadoAcesso({ status: "TRIAL", trialEndsAt: new Date(), plano: "PRATA" });
    expect(hoje.podeEscrever).toBe(true);
    expect(hoje.diasTrial).toBe(0);
  });
});
