// ============================================================
// O XML guardado da nota, no navegador.
//
// Os botões eram links soltos para a rota: quando algo falhava (permissão,
// sessão expirada, nota sem XML), o navegador abria uma aba em branco ou uma
// linha de texto cru, e para quem clicou "não funcionava". Aqui a ida ao
// servidor é um `fetch`: o que dá certo vira arquivo ou visualização, e o que
// dá errado vira uma mensagem que diz o quê.
// ============================================================

export type XmlDaNota = { texto: string; nome: string };

/** Busca o XML guardado. Lança `Error` com a explicação do servidor. */
export async function buscarXmlDaNota(notaId: string, chave: string): Promise<XmlDaNota> {
  let r: Response;
  try {
    r = await fetch(`/api/fiscal/entrada/${notaId}/xml?ver=1`, { cache: "no-store" });
  } catch {
    throw new Error("Sem conexão com o servidor. Confira a internet e tente de novo.");
  }

  const tipo = r.headers.get("content-type") ?? "";
  // Sessão vencida: a rota manda para o login, e o fetch segue o redirect até
  // a página HTML de entrar — não é XML nenhum.
  if (r.redirected || (r.ok && !tipo.includes("xml"))) {
    throw new Error("Sua sessão expirou. Entre de novo para abrir o XML.");
  }
  const texto = await r.text();
  if (!r.ok) throw new Error(texto.trim() || `O servidor recusou o XML (erro ${r.status}).`);

  const nome =
    /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `${chave}.xml`;
  return { texto, nome };
}

/** Entrega o texto como arquivo para o navegador salvar. */
export function salvarComoArquivo({ texto, nome }: XmlDaNota) {
  const url = URL.createObjectURL(new Blob([texto], { type: "application/xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // O clique já entregou o arquivo; o endereço temporário pode ir embora.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Abre o XML numa aba nova, no visualizador do próprio navegador.
 *
 * A aba nasce no clique — aberta depois da ida ao servidor, o navegador a
 * trataria como pop-up e bloquearia. Antes de apontá-la para o arquivo, a
 * permissão e a sessão são conferidas: se algo falhar, a aba fecha e o erro
 * aparece na tela de onde a pessoa clicou, em vez de uma aba com texto cru.
 */
export async function abrirXmlEmNovaAba(notaId: string, chave: string): Promise<void> {
  const aba = window.open("", "_blank");
  if (!aba) {
    throw new Error("O navegador bloqueou a nova aba. Permita pop-ups deste site e tente de novo.");
  }
  aba.document.title = "Abrindo o XML…";
  aba.document.body.textContent = "Abrindo o XML da nota…";
  try {
    await buscarXmlDaNota(notaId, chave);
    aba.location.replace(
      new URL(`/api/fiscal/entrada/${notaId}/xml?ver=1`, window.location.origin).href,
    );
  } catch (e) {
    aba.close();
    throw e;
  }
}
