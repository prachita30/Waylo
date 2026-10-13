import { brand } from '@waylo/shared';

/** Placeholder until Phase 3 builds the full homepage. */
export default function Home() {
  return (
    <section className="container-page py-16">
      <p className="t-meta">{brand.tagline}</p>
      <h1 className="t-display mt-3 max-w-2xl">{brand.heroHeadline}</h1>
    </section>
  );
}
