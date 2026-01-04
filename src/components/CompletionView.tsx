"use client";

export function CompletionView(props: { onBackToPlan: () => void }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 shadow-soft">
      <div className="text-sm text-emerald-800">All done</div>
      <div className="mt-2 text-3xl md:text-4xl tracking-tight text-emerald-950">
        You finished your sprint.
      </div>
      <div className="mt-3 text-[15px] text-emerald-900/80">
        Take a breath. Enjoy the momentum.
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={props.onBackToPlan}
          className="rounded-lg border border-emerald-700 bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 transition-colors"
        >
          Back to plan
        </button>
      </div>
    </div>
  );
}


