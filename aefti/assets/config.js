/* Configuration des tests de positionnement AEFTI
   ENDPOINT : adresse de l'application Web Google Apps Script (voir GUIDE-INSTALLATION.md).
   Tant qu'elle est vide, les tests fonctionnent en « mode démonstration » :
   le PDF est proposé au téléchargement au lieu d'être envoyé par email.
   L'adresse email de réception se règle dans le script Google (Code.gs), pas ici. */
window.AEFTI_CONFIG = {
  ENDPOINT: 'https://script.google.com/macros/s/AKfycbyvX7cTh58laS0mKZCM3OmcKG_atRJT3vb8k740g4qd_0NMGT4s9r61cmClP57KYjc3/exec'
};
