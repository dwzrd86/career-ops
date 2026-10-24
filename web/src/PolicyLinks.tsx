import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import privacy from "../../docs/PRIVACY.md?raw";
import terms from "../../docs/TERMS.md?raw";
import security from "../../docs/SECURITY_CONTACT.md?raw";

const policies = {
  privacy: { title: "Privacy notice", text: privacy },
  terms: { title: "Beta terms of use", text: terms },
  security: { title: "Security contact", text: security },
};

function PolicyDocument({ policy, onClose }: { policy: keyof typeof policies; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const text = policies[policy].text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  // Render policy text as escaped React text, never as unsanitized HTML.
  const readable = (value: string) => value.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/`([^`]+)`/g, "$1");
  return <dialog className="dialog policy-dialog" ref={dialog} onCancel={onClose} onClose={onClose} aria-labelledby="policy-dialog-title">
    <header><h2 id="policy-dialog-title">{policies[policy].title}</h2><button className="icon-button" type="button" aria-label="Close policy" onClick={onClose}><X size={18} /></button></header>
    <article className="policy-content">{text.split(/\n\s*\n/).map((block, index) => {
      if (/^#{1,3} /.test(block)) return <h3 key={index}>{readable(block.replace(/^#{1,3} /, ""))}</h3>;
      if (block.startsWith("|")) return <pre key={index}>{readable(block)}</pre>;
      if (block.startsWith("- ")) return <ul key={index}>{block.split(/\n- /).map((line, item) => <li key={item}>{readable(line.replace(/^- /, ""))}</li>)}</ul>;
      return <p key={index}>{readable(block)}</p>;
    })}</article>
  </dialog>;
}

export function PolicyLinks({ version }: { version?: string }) {
  const [policy, setPolicy] = useState<keyof typeof policies | null>(null);
  return <><div className="policy-buttons">{(Object.keys(policies) as Array<keyof typeof policies>).map(key => <button className="text-button" type="button" key={key} onClick={() => setPolicy(key)}>{policies[key].title}{key === "privacy" && version ? ` (version ${version})` : ""}</button>)}</div>
    {policy && <PolicyDocument policy={policy} onClose={() => setPolicy(null)} />}
  </>;
}
