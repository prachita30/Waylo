import { Link, useParams } from 'react-router';
import { Notice } from '@/components/ui/States';
import { LEGAL_DOCS } from '@/content/legal';
import NotFound from '../NotFound';

export default function LegalPage() {
  const { slug = '' } = useParams();
  const doc = LEGAL_DOCS[slug];
  if (!doc) return <NotFound />;
  return (
    <article className="container-page max-w-3xl py-10 sm:py-16">
      <nav aria-label="Legal documents" className="mb-8 flex flex-wrap gap-2">
        {Object.values(LEGAL_DOCS).map((d) => (
          <Link
            key={d.slug}
            to={`/legal/${d.slug}`}
            aria-current={d.slug === slug ? 'page' : undefined}
            className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 aria-[current=page]:border-ink aria-[current=page]:text-ink"
          >
            {d.title}
          </Link>
        ))}
      </nav>
      <h1 className="t-title">{doc.title}</h1>
      {doc.draft && (
        <Notice tone="warning" title="Draft for review" className="mt-4">
          This document has not yet been reviewed by legal counsel and may change before launch.
        </Notice>
      )}
      <p className="t-body mt-6 text-lg">{doc.intro}</p>
      <div className="mt-8 space-y-8">
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="t-section">{s.heading}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="t-body mt-3">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
