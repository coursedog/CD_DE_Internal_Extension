// Dark mode toggle functionality for Chrome extension
// Moved to external file to comply with Content Security Policy

// Apply theme immediately on script load (for faster initial render) without animating text color
document.documentElement.style.transition = 'none';
const initialTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', initialTheme);

// Initialize theme toggle when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = themeToggle.querySelector('.theme-icon');
  
  // Check for saved theme preference or default to light mode
  const savedTheme = localStorage.getItem('theme') || 'light';
  
  // Apply the theme immediately
  document.documentElement.setAttribute('data-theme', savedTheme);
  if (themeIcon) {
    themeIcon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  }
  
  // Add click event listener
  if (themeToggle) {
    themeToggle.addEventListener('click', function() {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      // Apply the new theme
      document.documentElement.style.transition = 'none';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      
      // Update icon
      if (themeIcon) {
        themeIcon.textContent = newTheme === 'dark' ? '☀️' : '🌙';
      }
      
      // Re-enable transitions after a tick
      setTimeout(() => { document.documentElement.style.transition = ''; }, 0);
      console.log('Theme switched to:', newTheme);
    });
  } else {
    console.warn('Theme toggle button not found');
  }
});
