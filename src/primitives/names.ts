/**
 * Given names for the deterministic name check in detect.ts: common Dutch given names and common names from the
 * other communities an EU insurer's customers come from (Turkish, Moroccan and Arabic, Polish, German, French,
 * Spanish, Italian, English, Nordic, Slavic). The list is hand-written data; no network or model produces it. A name
 * missing here is still caught after a person cue ("claimant", "Mr", "hit by") or as initials plus a surname.
 * Names that are also common words (Can, Art, Will, May, Said) are left out on purpose.
 */
export const GIVEN_NAMES: ReadonlySet<string> = new Set(
  `
  Abdel Abdullah Abel Adam Adriana Adrianus Agnieszka Ahmed Ahmet Aicha Aidan Aino Aisha Alain Alba Alejandro
  Aleksander Aleksandra Alessandro Alessia Alexander Alfie Ali Alice Amanda Amara Amber Amelia Amelie Amin
  Amina Ana Anastasia Anders Andrea Andreas Andreea Andrei Andrew Andrzej Anil Anja Anna Anne Annelies
  Annemarie Annemiek Anouar Anouk Anthony Antoine Antonio Antonius Antti Aoife Arjan Arjen Arno Arnold Arthur
  Astrid Aurelie Ava Ayla Aylin Ayse Bart Bas Beatriz Benjamin Bert Bianca Bilal Birgit Bjorn Boaz Bogdan
  Boris Brahim Bram Brenda Brian Britt Burak Camille Carla Carlos Carmen Carolien Casper Catharina Catherine
  Celine Cem Chantal Charles Charlotte Chiara Chidi Chloe Christiaan Christian Christine Christophe
  Christopher Claudia Coen Connor Cornelia Cornelis Corrie Cristian Cristina Daan Daniel Daphne Dariusz David
  Davide Debbie Demi Denise Deniz Dennis Diana Diederik Diego Dieter Dilara Dimitrios Dirk Dmitri Dolores
  Dorien Driss Duuk Ebru Edward Edwin Ekaterina Eleanor Elena Eleni Elias Elif Elin Eline Elisa Elisabeth
  Elizabeth Ella Ellen Elodie Emily Emine Emma Emre Erdem Erik Esmee Esra Esther Ethan Eva Evelien Evi Ewa
  Ewout Fatih Fatima Fatma Fedde Federica Federico Felix Femke Fenna Ferhat Fernando Finn Fleur Floor Florian
  Floris Francesca Francesco Francisco Franciscus Francois Frank Frans Fred Frederik Freek Freja Frieda
  Friedrich Geertruida George Georgios Gerard Gerben Gerda Gerrit Gheorghe Gijs Giorgia Giovanni Giulia
  Giuseppe Gokhan Grace Greet Greta Guillaume Guus Hafida Hakan Hamza Hanan Hannah Hanneke Hans Harry Hassan
  Hatice Heike Heinrich Heleen Helen Helga Helmut Hendrik Hendrika Hendrikus Henk Henry Hicham Hidde Hilde
  Hiroshi Hugo Hulya Hussein Ibrahim Ikram Ilias Ilse Imane Ineke Ines Inge Ingrid Ioana Irene Irina Iris Isa
  Isabel Isabelle Isla Ismail Ivan Ivo Jaap Jacco Jack Jacob Jacoba Jacobus Jacqueline Jakub Jamal James Jan
  Janneke Jasmijn Jasper Javier Jean Jeffrey Jelle Jennifer Jens Jeroen Jesse Jessica Jim Joanna Joao Jochem
  Joep Johan Johanna Johannes John Joke Jolanda Jonas Jonathan Joost Jordy Joris Jorn Jose Joseph Joshua
  Joyce Juan Judith Juha Julia Julian Julie Julien Juliette Jurgen Jurre Kaan Karen Karim Karin Karl Kasper
  Katarzyna Katerina Katherine Katrin Kees Kemal Kevin Khadija Khalid Kim Kirsten Klaus Koen Konstantinos
  Krzysztof Kwame Lara Lars Latifa Laura Lauren Laurens Laurent Layla Lea Leila Lena Lennart Leo Leon Leonie
  Levi Leyla Liam Lianne Lieke Liesbeth Lily Linda Lisa Loes Lois Lorenzo Lotte Luc Luca Lucas Lucia Lucy
  Luis Lukas Lukasz Luna Luuk Lynn Maarten Magdalena Magnus Malgorzata Malika Manon Manuel Marcel Marcin
  Marco Marek Margaret Margaretha Margaux Maria Mariam Mariana Marie Marieke Marije Marijke Mariska Marit
  Marjolein Mark Markus Marleen Marloes Marnix Marta Martijn Martina Martinus Mary Mason Mateusz Mathieu
  Mathijs Mats Matteo Matthew Matthias Matthijs Matti Maud Maurits Max Maximilian Mees Mehdi Mehmet Melek
  Menno Merel Merve Meryem Mia Michael Michal Michel Michelle Michiel Mieke Miguel Mihai Mikael Mike Mikhail
  Mila Milan Miranda Mirjam Mirthe Mitchell Mohamed Mohammad Mohammed Monika Monique Morris Mounir Muhammad
  Murat Mustafa Mustapha Nabil Nadia Naima Nancy Naomi Natalia Nathalie Ngozi Niamh Nicholas Nick Nico
  Nicolas Nicole Niek Niels Nienke Nikolai Nikos Nils Nina Noah Noor Nora Nordin Noud Noura Nuno Oksana Olga
  Oliver Olivia Olivier Omar Onur Oscar Osman Otis Otto Ozan Ozlem Pablo Paola Paolo Pascal Patricia Patrick
  Paul Paula Pawel Pedro Pepijn Peter Petra Petronella Petrus Philippe Pierre Piet Pieter Pilar Pim Piotr
  Priya Puck Quinten Rachel Rachid Rachida Rafael Raymond Rebecca Redouan Remco Renate Rene Renske Rianne
  Riccardo Richard Rick Rik Rob Robert Roberto Robin Roel Roland Romy Ronald Roos Rosa Roy Ruben Ruby Ruud
  Ryan Saar Sabine Saida Salma Sam Samantha Samir Samira Sander Sanne Sara Sarah Saskia Sean Sebastian Selim
  Selin Sem Sergei Sergio Serkan Sevgi Sibel Siddharth Siem Sigrid Silvia Simon Simone Siobhan Sipho Sjoerd
  Sofia Sofie Sonja Sophie Souad Soufiane Stan Stanislaw Stef Stefan Stefanie Stefano Stephanie Stephen
  Sterre Steven Stijn Sunil Susan Susanne Suzanne Suze Sven Svetlana Sylvia Sylvie Tamara Tarik Tatiana Tess
  Teun Thabo Thea Theodorus Thierry Thijs Thomas Tiago Tijn Tim Tineke Tobias Tolga Tom Tomasz Trudy Truus
  Tugba Tuomas Twan Tygo Umut Ursula Valentina Vasile Vera Victoria Vince Vincent Vladimir Volkan Ward Wendy
  Wesley Wessel Wilco Wilhelmina Wilhelmus Willem Willem-Jan Willemijn William Wim Wojciech Wolfgang Wout
  Wouter Xander Yara Yasemin Yasmina Yasmine Yassin Yilmaz Younes Youri Youssef Yuki Yulia Yusuf Yves Yvonne
  Zakaria Zbigniew Zeger Zehra Zeynep Zineb Zoe Zofia
`
    .split(/\s+/)
    .filter((name) => name !== "")
    .map((name) => name.toLowerCase()),
);
