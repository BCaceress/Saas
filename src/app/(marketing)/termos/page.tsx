import Link from "next/link";
import { Lista, PaginaLegal, Secao } from "../_components/legal";

export const metadata = {
  title: "Termos de uso — NoHub Market",
  description: "Condições de contratação e uso da plataforma NoHub Market.",
};

// ⚠️ MINUTA — preencha os campos entre colchetes com os dados da empresa e
// mande um advogado revisar antes de vender. O texto cobre a operação real do
// produto (SaaS multi-tenant, cobrança recorrente, dados fiscais de terceiros),
// mas contrato é responsabilidade de quem assina, não do gerador de texto.
const EMPRESA = "[RAZÃO SOCIAL LTDA]";
const CNPJ = "[00.000.000/0001-00]";
const ENDERECO = "[endereço completo]";
const EMAIL = "contato@nohub.market";
const FORO = "[comarca / UF]";

export default function TermosPage() {
  return (
    <PaginaLegal
      titulo="Termos de uso"
      atualizadoEm="27 de julho de 2026"
      resumo="Estas condições valem entre a NoHub Market e o mercado que contrata o sistema. Leia com atenção a parte de cobrança, suspensão por falta de pagamento e responsabilidade sobre dados fiscais — é onde moram as surpresas."
    >
      <Secao numero="1" titulo="Quem somos e o que este documento regula">
        <p>
          A plataforma NoHub Market é operada por {EMPRESA}, CNPJ {CNPJ}, com sede em {ENDERECO}{" "}
          (&ldquo;NoHub&rdquo;). Estes Termos regulam o acesso e o uso do sistema por pessoa
          jurídica ou empresário individual (&ldquo;Cliente&rdquo;) que contrate qualquer plano,
          inclusive durante o período de teste.
        </p>
        <p>
          O uso da plataforma implica concordância integral com estes Termos e com a{" "}
          <Link href="/privacidade" className="text-brand underline underline-offset-4">
            Política de Privacidade
          </Link>
          .
        </p>
      </Secao>

      <Secao numero="2" titulo="Objeto">
        <p>
          A NoHub concede ao Cliente licença de uso, não exclusiva e intransferível, de um software
          como serviço (SaaS) para gestão de mercado — cadastro de produtos, controle de estoque,
          compras, frente de caixa, clientes e relatórios — conforme o plano contratado.
        </p>
        <p>
          Módulos como emissão fiscal, autoatendimento e comodato são cobrados à parte e só ficam
          disponíveis quando contratados e habilitados.
        </p>
      </Secao>

      <Secao numero="3" titulo="Cadastro e acesso">
        <Lista
          itens={[
            "O Cliente é responsável pela veracidade dos dados cadastrais e pela guarda das credenciais de acesso.",
            "Cada usuário deve ter login próprio. Compartilhar senha é vedado e a NoHub não responde por operação feita com credencial cedida.",
            "O administrador da conta pode criar, alterar e remover acessos da própria equipe, respondendo pelo que esses usuários fizerem.",
          ]}
        />
      </Secao>

      <Secao numero="4" titulo="Período de teste">
        <p>
          Novas contas recebem 14 dias de teste com as funcionalidades do plano escolhido, sem
          cobrança e sem necessidade de cartão. Ao fim do período, o acesso entra em modo somente
          leitura até a contratação de um plano — os dados permanecem armazenados.
        </p>
      </Secao>

      <Secao numero="5" titulo="Planos, preços e pagamento">
        <Lista
          itens={[
            "A assinatura é mensal, cobrada de forma recorrente pelo meio de pagamento cadastrado no gateway (Mercado Pago).",
            "Os preços vigentes são os exibidos na tela Configurações → Plano no momento da contratação. Reajuste é comunicado com 30 dias de antecedência e só vale para ciclos seguintes.",
            "Add-ons cobrados por unidade (totem, loja adicional) são somados ao valor mensal conforme a quantidade contratada.",
            "Mudança de plano passa a valer no ciclo seguinte; não há cobrança proporcional retroativa.",
          ]}
        />
      </Secao>

      <Secao numero="6" titulo="Atraso e suspensão">
        <p>
          Recusada a cobrança, o Cliente tem 7 dias corridos de tolerância com acesso normal,
          contados do primeiro insucesso. Persistindo o débito, a conta entra em{" "}
          <strong className="text-ink">modo somente leitura</strong>: o Cliente continua consultando
          seus dados e relatórios, mas não registra vendas, movimentações de estoque nem novos
          cadastros.
        </p>
        <p>
          Os dados são preservados por 90 dias após a suspensão. Regularizado o pagamento nesse
          prazo, o acesso é restabelecido integralmente. Após 90 dias, a NoHub pode excluir
          definitivamente a base do Cliente, mediante aviso prévio por e-mail.
        </p>
      </Secao>

      <Secao numero="7" titulo="Cancelamento">
        <p>
          O Cliente pode cancelar a qualquer momento, pela própria tela de plano, sem multa. O
          acesso permanece até o fim do período já pago. Não há reembolso proporcional de mês
          iniciado.
        </p>
        <p>
          Antes do encerramento, o Cliente pode exportar seus dados em CSV pelas telas de
          relatórios. Mediante solicitação, a NoHub fornece um extrato completo em até 15 dias.
        </p>
      </Secao>

      <Secao numero="8" titulo="Obrigações do Cliente">
        <Lista
          itens={[
            "Usar a plataforma conforme a legislação aplicável, inclusive fiscal, sanitária e de proteção de dados.",
            "Manter corretos os dados fiscais (CNPJ, inscrição estadual, NCM, regime tributário, certificado digital e CSC). A NoHub transmite o que o Cliente informa — a responsabilidade tributária pelo conteúdo do documento emitido é do Cliente e do seu contador.",
            "Não usar a plataforma para atividade ilícita, nem tentar acessar dados de outro cliente, aplicar engenharia reversa ou sobrecarregar a infraestrutura.",
            "Obter, quando aplicável, o consentimento dos seus próprios clientes para o tratamento de dados pessoais registrados no sistema (cadastro, fidelização, CPF na nota).",
          ]}
        />
      </Secao>

      <Secao numero="9" titulo="Disponibilidade e suporte">
        <p>
          A NoHub empenha esforços para manter a plataforma disponível 24 horas por dia, admitidas
          paradas programadas de manutenção comunicadas com antecedência e interrupções causadas por
          terceiros (provedores de nuvem, gateways de pagamento, SEFAZ, operadoras).
        </p>
        <p>
          O suporte é prestado em português, por e-mail e canais divulgados na plataforma, em dias
          úteis. Planos com SLA específico têm as condições descritas na proposta comercial.
        </p>
      </Secao>

      <Secao numero="10" titulo="Propriedade intelectual">
        <p>
          O software, a marca, o código e a interface são de titularidade da NoHub. O contrato não
          transfere propriedade — apenas licencia o uso enquanto vigente. Os{" "}
          <strong className="text-ink">dados operacionais são do Cliente</strong>: a NoHub os trata
          exclusivamente para prestar o serviço, na forma da Política de Privacidade.
        </p>
      </Secao>

      <Secao numero="11" titulo="Limitação de responsabilidade">
        <p>
          A NoHub não responde por lucros cessantes, perda de oportunidade ou danos indiretos.
          Ressalvada a hipótese de dolo, a responsabilidade total fica limitada ao valor pago pelo
          Cliente nos 12 meses anteriores ao evento.
        </p>
        <p>
          A plataforma é ferramenta de apoio à gestão: conferência de estoque, apuração fiscal e
          decisões comerciais continuam sob responsabilidade do Cliente.
        </p>
      </Secao>

      <Secao numero="12" titulo="Alterações destes Termos">
        <p>
          Mudanças relevantes são comunicadas por e-mail e dentro da plataforma com 30 dias de
          antecedência. Se o Cliente não concordar, pode cancelar sem ônus antes da vigência.
        </p>
      </Secao>

      <Secao numero="13" titulo="Foro">
        <p>
          Fica eleito o foro da comarca de {FORO} para dirimir controvérsias, com renúncia a
          qualquer outro. Dúvidas sobre este documento: {EMAIL}.
        </p>
      </Secao>
    </PaginaLegal>
  );
}
