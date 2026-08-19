/**
 * Renderer du widget Brain Dump.
 *
 * Volontairement en JS natif : la barre doit apparaitre instantanement, monter un
 * framework pour un unique champ texte serait un cout de boot pur.
 */

const input = document.getElementById('dumpInput');

/** Vide le champ et referme la barre. */
function dismiss() {
  input.value = '';
  window.brainDumpAPI.hide();
}

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    dismiss();
    return;
  }

  if (event.key !== 'Enter') return;

  event.preventDefault();
  const text = input.value.trim();

  if (!text) {
    dismiss();
    return;
  }

  // Envoi sans attendre la reponse : le handler vit dans le process principal, il
  // survit donc au masquage de la fenetre, et bascule sur la file offline en cas
  // d'echec. Attendre le POST laisserait la barre a l'ecran jusqu'a 10 secondes sur
  // un reseau mort, ce qui ruinerait la promesse d'une capture en 3 secondes.
  window.brainDumpAPI.send(text);
  dismiss();
});

// Le process principal reaffiche la fenetre : on s'assure que le curseur y revient.
window.addEventListener('focus', () => {
  input.focus();
});

input.focus();
