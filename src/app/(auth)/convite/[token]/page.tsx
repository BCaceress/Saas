import Link from "next/link";
import { MailX, Clock, ShieldCheck } from "lucide-react";
import { auth } from "@/auth";
import { resolverConvite } from "@/lib/convites";
import { PERFIL_LABEL } from "@/lib/permissoes";
import { basePrisma } from "@/lib/prisma";
import { AceitarConvite } from "./_client";

export const metadata = { title: "Convite — NoHub Market" };

export default async function ConvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const convite = await resolverConvite(token);

  if (convite.estado === "invalido") {
    return (
      <Aviso
        icon={<MailX size={20} />}
        titulo="Convite inválido"
        texto="Este link não existe mais — pode já ter sido usado ou cancelado. Peça um novo a quem administra a conta."
      />
    );
  }

  if (convite.estado === "expirado") {
    return (
      <Aviso
        icon={<Clock size={20} />}
        titulo="Convite vencido"
        texto={`O link de acesso a ${convite.tenantNome} passou da validade. Peça um novo a quem administra a conta.`}
      />
    );
  }

  const session = await auth();
  const emailSessao = session?.user?.email?.toLowerCase().trim() ?? null;
  const bate = emailSessao === convite.email.toLowerCase();

  // Conta já existe mas ninguém está logado: mandar para o login, não o cadastro.
  const jaTemConta = !emailSessao
    ? !!(await basePrisma.user.findUnique({
        where: { email: convite.email },
        select: { id: true },
      }))
    : false;

  const perfis = [...new Set(convite.acessos.map((a) => PERFIL_LABEL[a.perfil]))];

  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--auth-brand)]">
        Convite de equipe
      </p>
      <h1 className="font-display text-[26px] font-bold leading-tight text-[var(--auth-ink)]">
        {convite.tenantNome}
      </h1>
      <p className="mt-1.5 text-sm text-[var(--auth-muted)]">
        {convite.convidadoPor
          ? `${convite.convidadoPor} convidou você para entrar na equipe.`
          : "Você foi convidado para entrar na equipe."}
      </p>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[var(--auth-line)] bg-[var(--auth-field)] p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--auth-brand)]/12 text-[var(--auth-brand)]">
          <ShieldCheck size={17} />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-medium text-[var(--auth-ink)]">
            {perfis.length > 0 ? perfis.join(" · ") : "Sem perfil definido"}
          </p>
          <p className="mt-0.5 break-all text-[var(--auth-muted)]">{convite.email}</p>
        </div>
      </div>

      <div className="mt-6">
        {emailSessao ? (
          <AceitarConvite
            token={token}
            emailConvite={convite.email}
            emailSessao={emailSessao}
            bate={bate}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <Link
              href={
                jaTemConta
                  ? `/login?callbackUrl=${encodeURIComponent(`/convite/${token}`)}`
                  : `/cadastro?convite=${token}`
              }
              className="inline-flex h-[52px] w-full items-center justify-center rounded-2xl bg-[var(--auth-brand)] text-[15px] font-semibold text-[var(--auth-on-brand,#04121a)] transition-opacity hover:opacity-90"
            >
              {jaTemConta ? "Entrar e aceitar" : "Criar conta e aceitar"}
            </Link>
            <p className="text-center text-xs text-[var(--auth-muted)]">
              Use o e-mail {convite.email} — o convite só vale para ele.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Aviso({
  icon,
  titulo,
  texto,
}: {
  icon: React.ReactNode;
  titulo: string;
  texto: string;
}) {
  return (
    <div>
      <span className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-[var(--auth-danger-soft)] text-[var(--auth-danger)]">
        {icon}
      </span>
      <h1 className="font-display text-[26px] font-bold leading-tight text-[var(--auth-ink)]">
        {titulo}
      </h1>
      <p className="mt-2 text-sm text-[var(--auth-muted)]">{texto}</p>
      <Link
        href="/login"
        className="mt-6 inline-flex h-[52px] w-full items-center justify-center rounded-2xl border border-[var(--auth-line-strong)] text-[15px] font-medium text-[var(--auth-ink)] transition-colors hover:bg-white/5"
      >
        Ir para o login
      </Link>
    </div>
  );
}
