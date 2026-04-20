window.tailwind = window.tailwind || {};
window.tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace']
          },
          colors: {
            brand: '#d97706',
            'brand-hover': '#b45309',
            cyan: '#c98d29',
            surface: '#f3f3ee',
            card: '#ffffff',
            border: '#e7e5de'
          },
          borderRadius: {
            xl: '12px',
            '2xl': '16px'
          }
        }
      }
    };
