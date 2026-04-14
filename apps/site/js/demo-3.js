// ── Sidebar (mobile toggle only, no auth) ──
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    var mainWrapper = document.getElementById('mainWrapper');

    document.getElementById('menuBtn').addEventListener('click', toggleMobileSidebar);

    function toggleMobileSidebar() {
      sidebar.classList.toggle('-translate-x-full');
      overlay.classList.toggle('hidden');
    }

    function handleResize() {
      if (window.innerWidth < 1024) {
        sidebar.classList.add('-translate-x-full');
        sidebar.classList.remove('sidebar-collapsed');
        sidebar.classList.add('sidebar-expanded');
        mainWrapper.style.marginLeft = '0';
        overlay.classList.add('hidden');
      } else {
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.remove('sidebar-collapsed');
        sidebar.classList.add('sidebar-expanded');
        mainWrapper.style.marginLeft = '240px';
      }
    }
    window.addEventListener('resize', handleResize);
    handleResize();

    // ── Sparklines ──
    function drawSparkline(canvas, data, color) {
      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      var w = canvas.width;
      var h = canvas.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(dpr, dpr);

      if (!data || data.length < 2) return;
      var max = Math.max.apply(null, data);
      var min = Math.min.apply(null, data);
      var range = max - min || 1;
      var step = w / (data.length - 1);

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      data.forEach(function(v, i) {
        var x = i * step;
        var y = h - ((v - min) / range) * (h - 2) - 1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    var sparkData = {
      keys: [2, 2, 3, 3, 3, 4, 4, 4, 4, 4],
      apps: [1, 2, 2, 2, 3, 3, 3, 3, 3, 3],
      calls: [80, 95, 110, 105, 120, 115, 130, 125, 127, 127],
      errors: [1.2, 0.9, 1.1, 0.7, 0.8, 1.0, 0.6, 0.9, 0.8, 0.8]
    };
    document.querySelectorAll('.sparkline').forEach(function(c) {
      var stat = c.dataset.stat;
      var colors = { keys: '#6366f1', apps: '#10b981', calls: '#06b6d4', errors: '#ef4444' };
      drawSparkline(c, sparkData[stat] || [], colors[stat] || '#6366f1');
    });

    // ── Usage Chart (static fake data) ──
    (function() {
      var days = [];
      for (var i = 0; i < 30; i++) {
        var d = new Date();
        d.setDate(d.getDate() - (29 - i));
        var base = 100 + Math.sin(i * 0.4) * 40;
        days.push({
          date: d.toISOString().split('T')[0],
          calls: Math.max(0, Math.round(base + (Math.random() - 0.5) * 30)),
          errors: Math.round(Math.random() * 4)
        });
      }

      var labels = days.map(function(d) {
        var dt = new Date(d.date);
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });
      var callsData = days.map(function(d) { return d.calls; });
      var errorsData = days.map(function(d) { return d.errors; });

      var ctx = document.getElementById('usageChart').getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'API Calls',
              data: callsData,
              borderColor: '#06b6d4',
              backgroundColor: 'rgba(6, 182, 212, 0.08)',
              fill: true,
              tension: 0.4,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: '#06b6d4',
              borderWidth: 2
            },
            {
              label: 'Errors',
              data: errorsData,
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.05)',
              fill: false,
              tension: 0.4,
              pointRadius: 3,
              pointBackgroundColor: '#ef4444',
              pointBorderColor: '#ef4444',
              borderWidth: 1.5,
              pointHoverRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 1000, easing: 'easeOutQuart' },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: {
                color: '#6b7280',
                font: { family: 'Inter', size: 12 },
                boxWidth: 12,
                boxHeight: 2,
                padding: 16
              }
            },
            tooltip: {
              backgroundColor: '#1e1e2e',
              titleColor: '#e5e7eb',
              bodyColor: '#9ca3af',
              borderColor: '#2a2a3a',
              borderWidth: 1,
              cornerRadius: 8,
              padding: 12,
              titleFont: { family: 'Inter', size: 13, weight: '600' },
              bodyFont: { family: 'Inter', size: 12 }
            }
          },
          scales: {
            x: {
              grid: { color: '#1e1e2e', drawBorder: false },
              ticks: {
                color: '#6b7280',
                font: { family: 'Inter', size: 11 },
                maxTicksLimit: 10
              },
              border: { display: false }
            },
            y: {
              grid: { color: '#1e1e2e', drawBorder: false },
              ticks: {
                color: '#6b7280',
                font: { family: 'Inter', size: 11 }
              },
              border: { display: false },
              beginAtZero: true
            }
          }
        }
      });
    })();
