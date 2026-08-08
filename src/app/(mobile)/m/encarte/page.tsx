import { requirePermissaoMobile } from "@/lib/guard";
import { llmConfigured } from "@/lib/llm";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { Card } from "@/components/ui/misc";
import { EncarteClient } from "./_client";

/**
 * Encarte, tabela de preço em PDF impresso, etiqueta de gôndola: papel que
 * chega com preço e vira digitação.
 *
 * `produto.preco` é a permissão certa — a tela existe para acabar em preço
 * gravado, e quem não pode mudar preço não teria o que fazer com a leitura.
 */
export default async function EncartePage() {
  await requirePermissaoMobile("produto.preco");

  return (
    <>
      <MobilePageHeader
        titulo="Ler encarte"
        descricao="Uma foto vira lista de preços para conferir."
        voltar="/m/scan"
      />

      {llmConfigured() ? (
        <EncarteClient />
      ) : (
        <Card className="p-4">
          <p className="font-display text-base font-semibold text-ink">
            Leitura por imagem indisponível
          </p>
          <p className="mt-1 text-sm text-ink-2">
            Esta conta ainda não tem a leitura por imagem configurada. Fale com o suporte
            para ligar o recurso.
          </p>
        </Card>
      )}
    </>
  );
}
