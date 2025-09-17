// js/notifications.js

const MAX_LOG_MESSAGES_SIDEBAR = 25;
const notificationLogElementSidebar = document.getElementById('notification-log-container');
const popupNotificationOverlay = document.getElementById('popup-notification-overlay');
const POPUP_VISIBLE_DURATION = 30000; 
let activePopupNotifications = new Set();

function addNotification(message, type = 'info') {
    const notificationKey = `${type}|${message}`; 
    
    // Enhanced duplicate prevention - allow certain types to repeat but with limitations
    if (activePopupNotifications.has(notificationKey)) {
        // Allow immediate damage/heal notifications to repeat (combat feedback)
        if (type === 'damage' || type === 'heal' || type === 'pet_attack' || type === 'enemy_action') {
            // These can repeat immediately for combat feedback
        } else {
            // All other notifications are blocked if still active
            return; 
        }
    }
    if (!popupNotificationOverlay) {
        console.warn("Popup notification overlay not found! Logging to console:", `(${type}) ${message}`);
        if (notificationLogElementSidebar) logToSidebar(message, type);
        return;
    }
    activePopupNotifications.add(notificationKey); 
    const popupDiv = document.createElement('div');
    popupDiv.classList.add('popup-notification', `notification-${type}`); 
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    popupDiv.appendChild(messageSpan);
    const closeButton = document.createElement('button');
    closeButton.classList.add('popup-notification-close');
    closeButton.innerHTML = '×'; 
    let timeoutId = null; 
    const removePopup = (manualClose = false) => {
        if (timeoutId) clearTimeout(timeoutId); 
        popupDiv.style.animation = 'fadeOutSlideOut 0.5s forwards';
        const onAnimationEnd = () => {
            if (popupDiv.parentNode === popupNotificationOverlay) popupNotificationOverlay.removeChild(popupDiv);
            activePopupNotifications.delete(notificationKey); 
            popupDiv.removeEventListener('animationend', onAnimationEnd); 
        };
        popupDiv.addEventListener('animationend', onAnimationEnd);
        if (manualClose && !popupDiv.style.animation) {
             if (popupDiv.parentNode === popupNotificationOverlay) popupNotificationOverlay.removeChild(popupDiv);
            activePopupNotifications.delete(notificationKey);
        }
    };
    closeButton.onclick = () => removePopup(true);
    popupDiv.appendChild(closeButton);
    if (popupNotificationOverlay.firstChild) popupNotificationOverlay.insertBefore(popupDiv, popupNotificationOverlay.firstChild);
    else popupNotificationOverlay.appendChild(popupDiv);
    timeoutId = setTimeout(() => removePopup(false), POPUP_VISIBLE_DURATION);
}
function logToSidebar(message, type) {
    if (!notificationLogElementSidebar) return;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('notification-message'); // Old sidebar class
    messageDiv.classList.add(`notification-${type}`); // Keep using type for color consistency
    messageDiv.textContent = message;

    notificationLogElementSidebar.insertBefore(messageDiv, notificationLogElementSidebar.firstChild);
    while (notificationLogElementSidebar.children.length > MAX_LOG_MESSAGES_SIDEBAR) {
        notificationLogElementSidebar.removeChild(notificationLogElementSidebar.lastChild);
    }
}