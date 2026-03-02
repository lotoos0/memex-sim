import { useMemo, useState } from 'react';
import { usePostStore } from '../../store/postStore';
import { useTokenStore } from '../../store/tokenStore';

interface Props {
  tokenId: string;
}

function fmtAgo(nowMs: number, ms: number): string {
  const d = Math.max(0, nowMs - ms);
  if (d < 60_000) return `${Math.round(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`;
  return `${Math.round(d / 86_400_000)}d`;
}

export default function TokenFeed({ tokenId }: Props) {
  const [draft, setDraft] = useState('');
  const posts = usePostStore((s) => s.postsByTokenId[tokenId] ?? []);
  const addUserPost = usePostStore((s) => s.addUserPost);
  const simNowMs = useTokenStore((s) => s.tokensById[tokenId]?.simTimeMs ?? 0);

  const rows = useMemo(() => posts.slice().reverse(), [posts]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    addUserPost(tokenId, text, 'you', { createdAtMs: simNowMs });
    setDraft('');
  };

  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {rows.length === 0 ? (
          <div className="h-[92px] flex items-center justify-center text-ax-text-dim/80">
            No feed activity yet.
          </div>
        ) : (
          rows.map((post) => (
            <div key={post.id} className="rounded border border-ax-border/60 bg-ax-bg/35 px-2 py-1.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide">
                <span className={[
                  post.tone === 'buy'
                    ? 'text-ax-green'
                    : post.tone === 'sell' || post.tone === 'warn'
                      ? 'text-ax-red'
                      : 'text-ax-text-dim',
                ].join(' ')}>
                  {post.kind}
                </span>
                <span className="text-ax-text-dim">{fmtAgo(simNowMs, post.createdAtMs)}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-ax-text">
                <span className="text-ax-text-dim">{post.author}: </span>
                {post.text}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-2 border-t border-ax-border pt-2 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Write post..."
          className="h-8 flex-1 rounded border border-ax-border bg-ax-surface2 px-2 text-[11px] text-ax-text outline-none focus:border-[#5f86ff]"
        />
        <button
          type="button"
          onClick={submit}
          className="h-8 rounded border border-[#5f86ff66] bg-[#5f86ff1a] px-2.5 text-[11px] text-[#8ba9ff] hover:bg-[#5f86ff26]"
        >
          Post
        </button>
      </div>
    </div>
  );
}
