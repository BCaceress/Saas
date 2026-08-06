"use client";

import * as React from "react";
import { Bell, BellOff, Loader2, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { readySWRegistration } from "@/components/app/sw-register";

/**
 * Liga as notificações de alerta neste aparelho.
 *
 * Três condições, nesta ordem:
 *  1. O navegador precisa de Notification + PushManager (senão nem aparece).
 *  2. No iOS, push SÓ funciona com o app instalado na tela de início (16.4+);
 *     fora disso `requestPermission` falha sem explicar nada — então mostramos
 *     o passo a passo de instalação em vez do botão.
 *  3. `requestPermission()` tem de ser chamado DENTRO do clique. iOS e Safari
 *     ignoram o pedido feito fora de um gesto do usuário.
 */

type Estado = "carregando" | "sem-suporte" | "precisa-instalar" | "desligado" | "ligado" | "negado";

function ehIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function instalado(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * A chave VAPID vem em base64url e o `subscribe` exige bytes.
 *
 * O buffer é criado explicitamente para o tipo ficar `Uint8Array<ArrayBuffer>`:
 * `new Uint8Array(n)` sozinho resolve para `ArrayBufferLike`, que inclui
 * `SharedArrayBuffer` e não satisfaz `BufferSource`.
 */
function chaveParaBytes(base64: string): Uint8Array<ArrayBuffer> {
  const preenchida = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const normal = preenchida.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normal);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function AtivarNotificacoes({ chavePublica }: { chavePublica: string }) {
  const [estado, setEstado] = React.useState<Estado>("carregando");
  const [ocupado, setOcupado] = React.useState(false);

  React.useEffect(() => {
    let vivo = true;

    // Toda a detecção vive num async: setState só nos callbacks, nunca no
    // corpo do efeito (senão vira render em cascata).
    (async () => {
      if (typeof window === "undefined") return;

      const suporta =
        "Notification" in window &&
        "PushManager" in window &&
        "serviceWorker" in navigator;

      if (!suporta) {
        if (ehIOS() && !instalado()) {
          // iOS sem instalar nem expõe PushManager — a causa é essa, não falta
          // de suporte do aparelho.
          if (vivo) setEstado("precisa-instalar");
          return;
        }
        if (vivo) setEstado("sem-suporte");
        return;
      }

      if (ehIOS() && !instalado()) {
        if (vivo) setEstado("precisa-instalar");
        return;
      }

      if (Notification.permission === "denied") {
        if (vivo) setEstado("negado");
        return;
      }

      const reg = await readySWRegistration();
      const inscricao = await reg?.pushManager.getSubscription();
      if (vivo) setEstado(inscricao ? "ligado" : "desligado");
    })();

    return () => {
      vivo = false;
    };
  }, []);

  async function ligar() {
    setOcupado(true);
    try {
      // Dentro do clique, sem await antes: o gesto precisa estar "vivo".
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setEstado(permissao === "denied" ? "negado" : "desligado");
        return;
      }

      const reg = await readySWRegistration();
      if (!reg) {
        toast.error("Não foi possível ativar", "O app precisa estar instalado.");
        return;
      }

      const inscricao = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(chavePublica),
      });

      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inscricao.toJSON()),
      });
      if (!r.ok) throw new Error("Servidor recusou a inscrição.");

      setEstado("ligado");
      toast.success("Notificações ligadas.", "Você recebe os alertas críticos aqui.");
    } catch (e) {
      toast.error(
        "Não foi possível ativar",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setOcupado(false);
    }
  }

  async function desligar() {
    setOcupado(true);
    try {
      const reg = await readySWRegistration();
      const inscricao = await reg?.pushManager.getSubscription();
      if (inscricao) {
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(inscricao.endpoint)}`, {
          method: "DELETE",
        });
        await inscricao.unsubscribe();
      }
      setEstado("desligado");
      toast.success("Notificações desligadas neste aparelho.");
    } catch {
      toast.error("Não foi possível desligar", "Tente de novo em instantes.");
    } finally {
      setOcupado(false);
    }
  }

  if (estado === "carregando" || estado === "sem-suporte") return null;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span
          className={
            estado === "ligado"
              ? "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok-soft text-ok"
              : "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"
          }
        >
          {estado === "ligado" ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold text-ink">
            Avisos no celular
          </p>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {estado === "ligado"
              ? "Você recebe os alertas críticos mesmo com o app fechado."
              : "Ruptura, validade e pedido parado chegam sem você abrir o sistema."}
          </p>
        </div>
      </div>

      {estado === "precisa-instalar" && (
        <ol className="mt-3 space-y-2 text-[13px] text-ink-2">
          <li className="flex items-center gap-2">
            <Share className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            Toque em <strong className="font-medium text-ink">Compartilhar</strong>
          </li>
          <li className="flex items-center gap-2">
            <SquarePlus className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <strong className="font-medium text-ink">Adicionar à Tela de Início</strong> — o
            iPhone só permite avisos com o app instalado
          </li>
        </ol>
      )}

      {estado === "negado" && (
        <p className="mt-3 text-[13px] text-muted">
          Os avisos estão bloqueados para este site. Libere nas configurações do
          navegador e volte aqui.
        </p>
      )}

      {estado === "desligado" && (
        <Button onClick={ligar} disabled={ocupado} className="mt-3 w-full">
          {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Ligar avisos
        </Button>
      )}

      {estado === "ligado" && (
        <Button
          variant="secondary"
          onClick={desligar}
          disabled={ocupado}
          className="mt-3 w-full"
        >
          {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Desligar neste aparelho
        </Button>
      )}
    </Card>
  );
}
