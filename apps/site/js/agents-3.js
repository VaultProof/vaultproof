// Reveal on scroll
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
        }, { threshold: 0.1 });
        document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

        // Waitlist form
        function handleWaitlist(e) {
            e.preventDefault();
            const form = e.target;
            const emailId = form.querySelector('input[type=email]').id;
            const successId = emailId === 'waitlistEmail' ? 'waitlistSuccess' : 'waitlistSuccess2';
            const email = document.getElementById(emailId).value;

            fetch('https://staging-api.vaultproof.dev/analytics/event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'waitlist_signup', page: '/agents', email }),
            }).catch(() => {});

            document.getElementById(successId).classList.remove('hidden');
            form.reset();
        }
