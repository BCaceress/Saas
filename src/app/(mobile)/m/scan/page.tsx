import { requirePermissaoMobile } from "@/lib/guard";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { ScanClient } from "./_client";

/**
 * Consulta por código de barras. Guard aqui e não num layout porque `/m/scan`
 * é a única tela da superfície que exige `produto.ver` — a mesma permissão que
 * a action confere do outro lado, para quem chega pela URL não entrar de lado.
 */
export default async function ScanPage() {
  await requirePermissaoMobile("produto.ver");

  return (
    <>
      <MobilePageHeader
        titulo="Escanear"
        descricao="Preço, saldo e validade na hora."
      />
      <ScanClient />
    </>
  );
}
