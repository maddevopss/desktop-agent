/**
 * Renderer du Spotlight — volontairement en JS natif, sans framework.
 *
 * La barre doit apparaitre instantanement : la fenetre est creee une seule fois au
 * demarrage puis simplement cachee/reaffichee. Monter React ici ajouterait un cout de
 * boot pour un unique champ texte.
 */

const input = document.getElementById("idea");

/**
 * Vide le champ et rend la main. La fermeture est seche : on n'attend jamais la
 * confirmation reseau, sinon la promesse des "3 secondes" tombe a l'eau.
 */
function dismiss() {
  input.value = "";
  window.spotlightAPI.close();
}

input.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    dismiss();
    return;
  }

  if (event.key !== "Enter") return;

  event.preventDefault();
  const text = input.value.trim();

  if (!text) {
    dismiss();
    return;
  }

  // Fire-and-forget assume : le handler vit dans le process principal, il survit donc
  // au masquage de la fenetre. En cas d'echec reseau il basculera sur la file offline.
  window.spotlightAPI.captureIdea(text);
  dismiss();
});

// Le process principal reaffiche la fenetre ; on s'assure que le curseur y est.
window.addEventListener("focus", () => {
  input.focus();
});

input.focus();
