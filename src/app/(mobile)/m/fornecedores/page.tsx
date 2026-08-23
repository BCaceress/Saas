import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { loadFornecedoresMobile } from "./_data";
import { FornecedoresClient } from "./_client";

export const metadata = { title: "Fornecedores — NoHub Market" };

/**
 * Agenda de fornecedores no celular — consulta e contato, nada de cadastro.
 *
 * O centro de gestão do fornecedor (integração, catálogo, condições, financeiro,
 * contatos) continua na tela de mesa: são sete abas, e nenhuma delas é pergunta
 * de quem está de pé na loja. O que se precisa daqui é curto e sempre o mesmo —
 * quem é, de onde é, tem pedido vindo, e como falo com ele agora. Por isso
 * telefone e WhatsApp são links nativos: o aparelho que mostra a lista é o
 * mesmo que faz a ligação.
 */
export default async function FornecedoresMobilePage() {
  const ctx = await requirePermissaoMobile("fornecedor.ver");

  const fornecedores = await withTenant(ctx, loadFornecedoresMobile);
  const ativos = fornecedores.filter((f) => f.ativo).length;

  return (
    <>
      <MobilePageHeader
        titulo="Fornecedores"
        descricao={`${ativos} ${ativos === 1 ? "fornecedor ativo" : "fornecedores ativos"}`}
      />
      <FornecedoresClient fornecedores={fornecedores} />
    </>
  );
}
