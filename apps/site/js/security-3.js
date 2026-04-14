document.addEventListener('DOMContentLoaded', () => {
            const links = document.querySelectorAll('#sidebar-nav .nav-link');
            const sections = [];

            links.forEach(link => {
                const id = link.getAttribute('href')?.slice(1);
                if (id) {
                    const el = document.getElementById(id);
                    if (el) sections.push({ id, el, link });
                }
            });

            const activate = () => {
                let current = sections[0];
                for (const s of sections) {
                    if (s.el.getBoundingClientRect().top <= 120) current = s;
                }
                links.forEach(l => l.classList.remove('active'));
                if (current) current.link.classList.add('active');
            };

            window.addEventListener('scroll', activate, { passive: true });
            activate();
        });
