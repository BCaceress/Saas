import { requireActiveTenant } from "@/lib/current-tenant";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { EstoqueConfigClient } from "./_client";

/** Miolo de "Estoque e alertas" — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoEstoque() {
  const { tenant } = await requireActiveTenant();
  const policy = policyDoTenant(tenant);
  return (
    <EstoqueConfigClient
      initial={{
        tipoControleEstoque: policy.tipo,
        periodoMediaDias: policy.periodoMediaDias,
        diasCobertura: policy.diasCobertura,
        coberturaCriticaPct: Math.round(policy.fatorCritico * 100),
        estoqueMinimoPadrao: tenant.estoqueMinimoPadrao,
        produtoParadoDias: tenant.produtoParadoDias,
        validadeAlertaDias: tenant.validadeAlertaDias,
        recebimentoExigeContagem: tenant.recebimentoExigeContagem,
        conferenciaCega: tenant.conferenciaCega,
      }}
      multiPonto={(tenant.numPontos ?? 1) > 1}
    />
  );
}
