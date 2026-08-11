import { ConteudoUsuarios } from "@/app/(app)/configuracoes/usuarios/_conteudo";

export const metadata = { title: "Usuários — NoHub Market" };

/**
 * Cabeçalho não mora aqui: o botão "Convidar pessoa" fica na linha do título e
 * abre uma folha (estado do cliente), então quem desenha o `MobilePageHeader` é
 * o próprio `UsuariosClient` — ver `variante` em `_conteudo.tsx`.
 */
export default function UsuariosMobilePage() {
  return <ConteudoUsuarios variante="mobile" />;
}
