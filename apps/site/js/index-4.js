(function() {
    function isLoggedIn() {
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                try {
                    var d = JSON.parse(localStorage.getItem(key));
                    if (d && d.access_token && d.expires_at > Date.now() / 1000) return true;
                } catch(e) {}
            }
        }
        return false;
    }
    if (isLoggedIn()) {
        document.querySelectorAll('.nav-dashboard').forEach(function(el) {
            el.style.display = '';
        });
    }

    // Highlight Pricing nav link when clicked — stays white until user leaves page
    var pricingLinks = document.querySelectorAll('a[href="#pricing"], a[href="/#pricing"]');
    function activatePricing() {
        pricingLinks.forEach(function(link) {
            link.classList.remove('text-gray-400', 'hover:text-white');
            link.classList.add('text-white', 'font-medium');
        });
    }
    pricingLinks.forEach(function(link) { link.addEventListener('click', activatePricing); });
    if (window.location.hash === '#pricing') activatePricing();
})();

// Stats carousel
(function() {
  const track = document.getElementById('statsTrack');
  const dotsContainer = document.getElementById('carouselDots');
  if (!track || !dotsContainer) return;

  const slides = track.children;
  const totalSlides = slides.length;
  let currentIndex = 0;
  let autoplayTimer;

  function getVisibleCount() {
    if (window.innerWidth >= 1024) return 3;
    if (window.innerWidth >= 640) return 2;
    return 1;
  }

  function getMaxIndex() {
    return Math.max(0, totalSlides - getVisibleCount());
  }

  function buildDots() {
    dotsContainer.innerHTML = '';
    const maxIdx = getMaxIndex();
    for (let i = 0; i <= maxIdx; i++) {
      const dot = document.createElement('button');
      dot.className = 'w-1.5 h-1.5 rounded-full transition-all ' + (i === currentIndex ? 'bg-indigo-400 w-3' : 'bg-gray-600');
      dot.onclick = function() { goTo(i); };
      dotsContainer.appendChild(dot);
    }
  }

  function goTo(index) {
    const maxIdx = getMaxIndex();
    currentIndex = Math.max(0, Math.min(index, maxIdx));
    const slideWidth = 100 / getVisibleCount();
    track.style.transform = 'translateX(-' + (currentIndex * slideWidth) + '%)';
    buildDots();
    resetAutoplay();
  }

  window.carouselPrev = function() { goTo(currentIndex - 1); };
  window.carouselNext = function() { goTo(currentIndex + 1); };

  function resetAutoplay() {
    clearInterval(autoplayTimer);
    autoplayTimer = setInterval(function() {
      if (currentIndex >= getMaxIndex()) { goTo(0); }
      else { goTo(currentIndex + 1); }
    }, 4000);
  }

  window.addEventListener('resize', function() { goTo(Math.min(currentIndex, getMaxIndex())); });
  buildDots();
  resetAutoplay();
})();
