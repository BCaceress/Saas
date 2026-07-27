import Link from "next/link";
import { Lista, PaginaLegal, Secao } from "../_components/legal";

export const metadata = {
  title: "Política de privacidade — NoHub Market",
  description: "Como a NoHub Market trata dados pessoais, conforme a LGPD.",
};

// ⚠️ MINUTA — preencha os campos entre colchetes e revise com o encarregado de
// dados antes de publicar. A lista de subprocessadores precisa refletir o que
// está de fato em produção; ela é a parte que mais envelhece.
const EMPRESA = "[RAZÃO SOCIAL LTDA]";
const CNPJ = "[00.000.000/0001-00]";
const ENCARREGADO = "[nome do encarregado]";
const EMAIL_DPO = "privacidade@nohub.market";

export default function PrivacidadePage() {
  return (
    <PaginaLegal
      titulo="Política de privacidade"
      atualizadoEm="27 de julho de 2026"
      resumo="Explica quais dados a NoHub Market coleta, por que, com quem compartilha e como exercer seus direitos sob a LGPD (Lei 13.709/2018). Vale tanto para quem usa o sistema quanto para o consumidor cujo cadastro é registrado por um mercado cliente."
    >
      <Secao numero="1" titulo="Quem controla os dados">
        <p>
          {EMPRESA}, CNPJ {CNPJ}, é a <strong className="text-ink">controladora</strong> dos dados
          de quem contrata e usa a plataforma (operador do mercado e sua equipe).
        </p>
        <p>
          Quanto aos dados dos consumidores finais cadastrados por um mercado cliente (nome, CPF,
          telefone, histórico de compra), a NoHub atua como{" "}
          <strong className="text-ink">operadora</strong>: trata esses dados a pedido e sob a
          instrução do mercado, que é o controlador. Pedidos de exclusão desses dados devem ser
          dirigidos ao mercado onde a compra foi feita.
        </p>
        <p>
          Encarregado (DPO): {ENCARREGADO} — {EMAIL_DPO}.
        </p>
      </Secao>

      <Secao numero="2" titulo="Dados que tratamos">
        <Lista
          itens={[
            <>
              <strong className="text-ink">Cadastro da conta:</strong> nome, e-mail, senha (guardada
              apenas como hash), telefone, CNPJ, razão social e endereço do estabelecimento.
            </>,
            <>
              <strong className="text-ink">Uso da plataforma:</strong> registros de acesso, endereço
              IP, data e hora das operações e trilha de auditoria das ações — exigidos pelo Marco
              Civil da Internet e necessários para segurança.
            </>,
            <>
              <strong className="text-ink">Operação do mercado:</strong> produtos, estoque, vendas,
              fornecedores e documentos fiscais. Podem conter dados pessoais de terceiros inseridos
              pelo Cliente.
            </>,
            <>
              <strong className="text-ink">Cobrança:</strong> plano contratado, histórico de
              pagamento e identificadores da assinatura no gateway. Dados de cartão{" "}
              <strong className="text-ink">não passam pelos nossos servidores</strong> — ficam no
              Mercado Pago.
            </>,
          ]}
        />
      </Secao>

      <Secao numero="3" titulo="Por que tratamos e com qual base legal">
        <Lista
          itens={[
            "Execução do contrato (art. 7º, V): criar e manter a conta, prestar o serviço, processar a assinatura e dar suporte.",
            "Cumprimento de obrigação legal (art. 7º, II): guarda de registros de acesso, emissão e armazenamento de documentos fiscais, obrigações tributárias.",
            "Legítimo interesse (art. 7º, IX): segurança da plataforma, prevenção a fraude, melhoria do produto a partir de métricas agregadas.",
            "Consentimento (art. 7º, I): comunicações de marketing, que você pode revogar a qualquer momento pelo link de descadastro.",
          ]}
        />
      </Secao>

      <Secao numero="4" titulo="Com quem compartilhamos">
        <p>
          Não vendemos dados. Compartilhamos apenas com fornecedores necessários à operação, sob
          contrato e limitados à finalidade:
        </p>
        <Lista
          itens={[
            "Infraestrutura e hospedagem da aplicação (provedor de nuvem).",
            "Banco de dados gerenciado, com dados armazenados em território brasileiro sempre que a região estiver disponível.",
            "Mercado Pago — processamento da assinatura e dos pagamentos do PDV.",
            "Provedor de e-mail transacional — envio de convites, redefinição de senha e avisos de cobrança.",
            "Provedor de emissão fiscal — transmissão de NFC-e/NF-e à SEFAZ, quando o módulo fiscal estiver contratado.",
            "Autoridades públicas, quando houver requisição legal ou ordem judicial.",
          ]}
        />
        <p>
          Alguns fornecedores podem processar dados fora do Brasil. Nesses casos, exigimos cláusulas
          contratuais que garantam nível de proteção compatível com a LGPD.
        </p>
      </Secao>

      <Secao numero="5" titulo="Segurança">
        <Lista
          itens={[
            "Isolamento por cliente em duas camadas: filtro obrigatório na aplicação e Row Level Security no banco de dados.",
            "Senhas guardadas com hash (bcrypt); credenciais de terceiros (gateway, provedor fiscal, CSC da SEFAZ) guardadas cifradas em AES-256-GCM.",
            "Tráfego sempre em HTTPS; acesso administrativo restrito a lista nominal.",
            "Limite de tentativas de login e registro de eventos de segurança.",
          ]}
        />
        <p>
          Nenhum sistema é infalível. Em caso de incidente com risco relevante, comunicamos os
          titulares afetados e a ANPD nos prazos da lei.
        </p>
      </Secao>

      <Secao numero="6" titulo="Por quanto tempo guardamos">
        <Lista
          itens={[
            "Dados da conta: enquanto o contrato durar e por 90 dias após o encerramento.",
            "Documentos fiscais e registros contábeis: 5 anos, por exigência legal.",
            "Registros de acesso: 6 meses, conforme o Marco Civil da Internet.",
            "Dados de cobrança: 5 anos, para fins fiscais e de defesa em eventual litígio.",
          ]}
        />
      </Secao>

      <Secao numero="7" titulo="Seus direitos">
        <p>
          A LGPD garante a você: confirmação da existência de tratamento, acesso, correção,
          anonimização ou eliminação de dados desnecessários, portabilidade, informação sobre
          compartilhamento, revogação do consentimento e oposição a tratamento feito com base em
          legítimo interesse.
        </p>
        <p>
          Para exercer qualquer um deles, escreva para {EMAIL_DPO}. Respondemos em até 15 dias.
          Podemos pedir confirmação de identidade antes de atender — é proteção sua.
        </p>
      </Secao>

      <Secao numero="8" titulo="Cookies">
        <p>
          Usamos apenas cookies necessários ao funcionamento: sessão autenticada, preferência de
          tema e proteção contra requisições forjadas. Não usamos cookies de publicidade nem
          rastreamento de terceiros para perfilamento.
        </p>
      </Secao>

      <Secao numero="9" titulo="Alterações">
        <p>
          Esta política pode ser atualizada. Mudanças relevantes são avisadas por e-mail e dentro da
          plataforma. A data de vigência no topo indica a versão em vigor. Veja também os{" "}
          <Link href="/termos" className="text-brand underline underline-offset-4">
            Termos de uso
          </Link>
          .
        </p>
      </Secao>
    </PaginaLegal>
  );
}
