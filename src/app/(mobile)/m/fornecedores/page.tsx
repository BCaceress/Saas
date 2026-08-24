import { requirePermissaoMobile } from "@/lib/guard";
import { podeEmAlguma } from "@/lib/permissoes";
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
 *
 * Os CONTATOS vêm junto e podem ser cadastrados daqui — é a única parte do
 * centro de gestão que nasce no chão: o vendedor passa o WhatsApp na entrega,
 * e sem uma pessoa cadastrada a cotação não tem para quem ir.
 */
export default async function FornecedoresMobilePage() {
  const ctx = await requirePermissaoMobile("fornecedor.ver");

  const fornecedores = await withTenant(ctx, loadFornecedoresMobile);
  const ativos = fornecedores.filter((f) => f.ativo).length;
  // Só para a UI — quem autoriza a escrita é o guard dentro da action.
  const podeEditar = podeEmAlguma(ctx.acessos, "fornecedor.editar");

  return (
    <>
      <MobilePageHeader
        titulo="Fornecedores"
        descricao={`${ativos} ${ativos === 1 ? "fornecedor ativo" : "fornecedores ativos"}`}
      />
      <FornecedoresClient fornecedores={fornecedores} podeEditar={podeEditar} />
    </>
  );
}
